import { roundMoney } from './utils.js';

export function convertToGbp(value, currency, settings = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const normalised = String(currency || '').toUpperCase();
  if (normalised === 'GBP') return roundMoney(amount);
  if (normalised === 'EUR') return roundMoney(amount * Number(settings.eurToGbp || 0.86));
  if (normalised === 'USD') return roundMoney(amount * Number(settings.usdToGbp || 0.78));
  return null;
}

function bestCardmarketPrice(card, settings) {
  const prices = card?.cardmarket?.prices || {};
  const candidates = [
    ['cardmarket trend', prices.trendPrice],
    ['cardmarket avg30', prices.avg30],
    ['cardmarket averageSellPrice', prices.averageSellPrice],
    ['cardmarket avg7', prices.avg7],
    ['cardmarket lowPrice', prices.lowPrice]
  ];
  for (const [source, value] of candidates) {
    const gbp = convertToGbp(value, 'EUR', settings);
    if (gbp) return { marketPriceGbp: gbp, marketPriceSource: `${source} → GBP static FX` };
  }
  return null;
}

function bestTcgPlayerPrice(card, settings) {
  const priceGroups = card?.tcgplayer?.prices || {};
  const preferredKeys = ['holofoil', 'reverseHolofoil', 'normal', '1stEditionHolofoil', 'unlimitedHolofoil'];
  for (const key of preferredKeys) {
    const group = priceGroups[key];
    if (!group) continue;
    const market = group.market ?? group.mid ?? group.low;
    const gbp = convertToGbp(market, 'USD', settings);
    if (gbp) return { marketPriceGbp: gbp, marketPriceSource: `tcgplayer ${key} → GBP static FX` };
  }
  for (const [key, group] of Object.entries(priceGroups)) {
    const market = group?.market ?? group?.mid ?? group?.low;
    const gbp = convertToGbp(market, 'USD', settings);
    if (gbp) return { marketPriceGbp: gbp, marketPriceSource: `tcgplayer ${key} → GBP static FX` };
  }
  return null;
}

export function estimateCardMarketPriceGbp(card, settings = {}) {
  return bestCardmarketPrice(card, settings) || bestTcgPlayerPrice(card, settings) || {
    marketPriceGbp: null,
    marketPriceSource: 'no card market price available'
  };
}

export function calculateDealScore({ listingTotalGbp, marketPriceGbp, minDealPercent = 15, monsterDealPercent = 35 }) {
  const listing = Number(listingTotalGbp);
  const market = Number(marketPriceGbp);
  if (!Number.isFinite(listing) || listing <= 0 || !Number.isFinite(market) || market <= 0) {
    return { dealPercent: null, savingGbp: null, rating: 'unknown', label: 'Needs market price' };
  }
  const saving = roundMoney(market - listing);
  const dealPercent = Math.round(((market - listing) / market) * 1000) / 10;
  let rating = 'overpriced';
  let label = 'Above market';
  if (dealPercent >= monsterDealPercent) { rating = 'monster'; label = 'Monster deal'; }
  else if (dealPercent >= 25) { rating = 'strong'; label = 'Strong deal'; }
  else if (dealPercent >= minDealPercent) { rating = 'watch'; label = 'Worth checking'; }
  else if (dealPercent >= 0) { rating = 'fair'; label = 'Fair price'; }
  return { dealPercent, savingGbp: saving, rating, label };
}

export function listingRiskFlags(title = '', target = {}) {
  const text = `${title} ${target?.notes || ''}`.toLowerCase();
  const checks = [
    ['proxy/custom', /\b(proxy|custom|fan\s?art|orica|replica|not official)\b/],
    ['digital/code only', /\b(code card|digital|online code|ptcgo|tcg live)\b/],
    ['empty packaging', /\b(empty|wrapper only|box only|pack wrapper|no cards)\b/],
    ['damaged', /\b(damaged|creased|bent|played|poor|hp\b|heavy play|water damage|read description)\b/],
    ['bundle/lot', /\b(bundle|joblot|job lot|lot of|collection|bulk)\b/],
    ['graded/slab', /\b(psa|cgc|bgs|ace grading|slab|graded)\b/],
    ['possible reseal', /\b(resealed|reseal|opened|loose pack|weighed|light pack|heavy pack)\b/],
    ['language mismatch', /\b(japanese|korean|chinese|thai|german|french|spanish|italian)\b/],
    ['stock image', /\b(stock photo|stock image|image for reference)\b/]
  ];
  const flags = checks.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  if (target?.type === 'card' && /\b(etb|elite trainer|booster box|sealed|tin|collection box)\b/.test(text)) flags.push('sealed mismatch');
  return [...new Set(flags)];
}
