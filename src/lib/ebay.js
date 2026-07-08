import { calculateDealScore, listingRiskFlags } from './pricing.js';
import { clampNumber, decodeHtml, roundMoney, stripTags, uniqueBy } from './utils.js';

const cache = new Map();
let lastEbayFetchAt = 0;

export function buildEbaySearchUrl({ query, sold = false, page = 1, listingType = 'all', condition = 'all' }) {
  const url = new URL('https://www.ebay.co.uk/sch/i.html');
  url.searchParams.set('_nkw', query || 'pokemon cards');
  url.searchParams.set('_from', 'R40');
  url.searchParams.set('_sop', sold ? '13' : '1');
  url.searchParams.set('_ipg', '60');
  url.searchParams.set('_pgn', String(page));
  url.searchParams.set('LH_PrefLoc', '1');
  if (sold) { url.searchParams.set('LH_Sold', '1'); url.searchParams.set('LH_Complete', '1'); }
  if (listingType === 'auction') url.searchParams.set('LH_Auction', '1');
  if (listingType === 'bin') url.searchParams.set('LH_BIN', '1');
  if (condition === 'used') url.searchParams.set('LH_ItemCondition', '3000');
  if (condition === 'new') url.searchParams.set('LH_ItemCondition', '1000');
  return url.toString();
}

export async function searchEbayExperimental({ query, settings = {}, sold = false, pages = 1, listingType = 'all', condition = 'all' }) {
  const maxPages = clampNumber(pages, 1, 2, 1);
  const allResults = [];
  const warnings = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = buildEbaySearchUrl({ query, sold, page, listingType, condition });
    const cached = cache.get(url);
    if (cached && Date.now() - cached.createdAt < 10 * 60 * 1000) {
      allResults.push(...cached.results);
      continue;
    }
    await throttle(settings.ebayThrottleMs || 3200);
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-GB,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (compatible; PokeBayLocalDealResearch/0.2; +https://github.com/DrDoback06/PokeBay)'
        }
      }, 12000);
      if (!response.ok) {
        warnings.push(`eBay public search returned ${response.status}. Use the generated eBay links manually or add official eBay API support later.`);
        continue;
      }
      const html = await response.text();
      if (/captcha|robot|access denied|pardon our interruption/i.test(html)) {
        warnings.push('eBay returned an anti-bot or access-check page. Generated manual links are still available.');
        continue;
      }
      const parsed = parseEbayListings(html, { sourceUrl: url, sold });
      if (!parsed.length) warnings.push(`No parseable eBay listing cards found for "${query}". Open the generated search link manually.`);
      cache.set(url, { createdAt: Date.now(), results: parsed });
      allResults.push(...parsed);
    } catch (error) {
      warnings.push(`Could not fetch eBay results for "${query}": ${error.message}. Open the generated search link manually.`);
    }
  }
  return { query, sold, results: uniqueBy(allResults, (item) => item.itemId || item.url).slice(0, 80), warnings };
}

export function scoreListingsForTarget(listings, target, settings = {}) {
  const marketPriceGbp = Number(target?.marketPriceGbp);
  return listings.map((listing) => {
    const total = roundMoney((listing.priceGbp || 0) + (listing.shippingGbp || 0));
    const score = calculateDealScore({ listingTotalGbp: total, marketPriceGbp, minDealPercent: settings.minDealPercent, monsterDealPercent: settings.monsterDealPercent });
    const flags = listingRiskFlags(listing.title, target);
    const titleMatchScore = titleMatchConfidence(listing.title, target);
    return {
      ...listing,
      targetId: target.id || null,
      targetName: target.name || target.query || null,
      targetType: target.type || 'card',
      marketPriceGbp: Number.isFinite(marketPriceGbp) ? marketPriceGbp : null,
      marketPriceSource: target.marketPriceSource || null,
      totalPriceGbp: total,
      ...score,
      flags,
      titleMatchScore
    };
  }).sort((a, b) => (b.dealPercent ?? -999) - (a.dealPercent ?? -999));
}

export function parseEbayListings(html, { sourceUrl, sold = false } = {}) {
  const blocks = html.split(/<li[^>]+class="[^"]*s-item[^"]*"/i).slice(1);
  const results = [];
  for (const block of blocks) {
    const title = pickTitle(block);
    if (!title || /shop on ebay/i.test(title)) continue;
    const linkMatch = block.match(/<a[^>]+class="[^"]*s-item__link[^"]*"[^>]+href="([^"]+)"/i) || block.match(/href="(https:\/\/www\.ebay\.co\.uk\/itm\/[^"]+)"/i);
    const url = linkMatch ? decodeHtml(linkMatch[1]).split('?')[0] : null;
    if (!url) continue;
    const priceText = stripTags(matchFirst(block, /<span[^>]+class="[^"]*s-item__price[^"]*"[^>]*>([\s\S]*?)<\/span>/i));
    const shippingText = stripTags(matchFirst(block, /<span[^>]+class="[^"]*s-item__shipping[^"]*"[^>]*>([\s\S]*?)<\/span>/i));
    const bidsText = stripTags(matchFirst(block, /<span[^>]+class="[^"]*s-item__bids[^"]*"[^>]*>([\s\S]*?)<\/span>/i));
    const location = stripTags(matchFirst(block, /<span[^>]+class="[^"]*s-item__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i));
    const image = decodeHtml(matchFirst(block, /<img[^>]+src="([^"]+)"/i));
    results.push({ itemId: extractEbayItemId(url), title, url, image: image || null, priceText, priceGbp: parsePounds(priceText), shippingText, shippingGbp: parseShipping(shippingText), bidsText: bidsText || null, location: location || null, sold, sourceUrl });
  }
  return uniqueBy(results, (item) => item.itemId || item.url);
}

function pickTitle(block) {
  const titleBlock = matchFirst(block, /<div[^>]+class="[^"]*s-item__title[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || matchFirst(block, /<span[^>]+role="heading"[^>]*>([\s\S]*?)<\/span>/i) || matchFirst(block, /aria-label="([^"]+)"/i);
  return stripTags(titleBlock).replace(/^New Listing\s*/i, '').trim();
}
function matchFirst(value, pattern) { const match = String(value || '').match(pattern); return match ? match[1] : ''; }
function parsePounds(value = '') { const match = decodeHtml(value).replace(/,/g, '').match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/); return match ? roundMoney(Number(match[1])) : null; }
function parseShipping(value = '') { const text = decodeHtml(value).toLowerCase(); if (!text || /free|collection/.test(text)) return 0; return parsePounds(text) || 0; }
function extractEbayItemId(url = '') { const match = String(url).match(/\/itm\/(?:[^/]+\/)?(\d{9,})/); return match ? match[1] : null; }
async function throttle(ms) { const elapsed = Date.now() - lastEbayFetchAt; if (elapsed < ms) await new Promise((resolve) => setTimeout(resolve, ms - elapsed)); lastEbayFetchAt = Date.now(); }
async function fetchWithTimeout(url, options, timeoutMs) { const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs); try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timeout); } }
function titleMatchConfidence(title = '', target = {}) {
  const haystack = title.toLowerCase();
  const needles = [target.name, target.setName, target.number].filter(Boolean).map((value) => String(value).toLowerCase()).filter((value) => value.length > 1);
  if (!needles.length) return 0;
  return Math.round((needles.filter((needle) => haystack.includes(needle)).length / needles.length) * 100);
}
