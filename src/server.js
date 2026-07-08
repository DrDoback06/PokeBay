import './lib/env.js';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchCards, searchSets, getSetCards, getCard, getSet } from './lib/pokemon.js';
import { addScanHistory, deleteWatchItem, getPortfolio, getWatchlist, importPortfolioSet, patchPortfolioCard, patchWatchItem, readDb, removePortfolioSet, upsertWatchItem, watchedPortfolioTargets } from './lib/storage.js';
import { buildEbaySearchUrl, scoreListingsForTarget, searchEbayExperimental } from './lib/ebay.js';
import { clampNumber, jsonResponse, readJsonBody, uniqueBy } from './lib/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const port = Number(process.env.POKEBAY_PORT || process.env.PORT || 3000);

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.webmanifest', 'application/manifest+json; charset=utf-8']
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    await serveStatic(res, url.pathname);
  } catch (error) {
    jsonResponse(res, error.statusCode || 500, { error: error.message || 'Unexpected server error', status: error.statusCode || 500, provider: error.provider || null, providerStatus: error.providerStatus || null });
  }
});

server.listen(port, () => console.log(`PokeBay running at http://localhost:${port}`));

async function handleApi(req, res, url) {
  const method = req.method || 'GET';
  const db = await readDb();
  if (method === 'GET' && url.pathname === '/api/health') return jsonResponse(res, 200, { ok: true, name: 'PokeBay', market: db.settings.market, experimentalEbayScanner: db.settings.experimentalEbayScanner, pokemonApiKeyConfigured: db.settings.pokemonApiKeyConfigured });
  if (method === 'GET' && url.pathname === '/api/settings') return jsonResponse(res, 200, db.settings);
  if (method === 'GET' && url.pathname === '/api/cards/search') {
    return jsonResponse(res, 200, await searchCards({ query: url.searchParams.get('q') || '', pageSize: clampNumber(url.searchParams.get('pageSize'), 1, 60, 24), page: clampNumber(url.searchParams.get('page'), 1, 99, 1), settings: db.settings }));
  }
  if (method === 'GET' && url.pathname === '/api/sets/search') {
    return jsonResponse(res, 200, await searchSets({ query: url.searchParams.get('q') || '', pageSize: clampNumber(url.searchParams.get('pageSize'), 1, 80, 36), page: clampNumber(url.searchParams.get('page'), 1, 99, 1) }));
  }
  const setCardsMatch = url.pathname.match(/^\/api\/sets\/([^/]+)\/cards$/);
  if (method === 'GET' && setCardsMatch) return jsonResponse(res, 200, await getSetCards({ setId: decodeURIComponent(setCardsMatch[1]), settings: db.settings }));

  if (url.pathname === '/api/portfolio' && method === 'GET') return jsonResponse(res, 200, { data: await getPortfolio() });
  if (url.pathname === '/api/portfolio/import-set' && method === 'POST') {
    const body = await readJsonBody(req);
    if (!body.setId) return jsonResponse(res, 400, { error: 'setId is required' });
    const [set, cardsResult] = await Promise.all([getSet(body.setId), getSetCards({ setId: body.setId, settings: db.settings })]);
    const tracker = await importPortfolioSet(set, cardsResult.data || []);
    return jsonResponse(res, 201, { data: tracker });
  }
  const portfolioCardMatch = url.pathname.match(/^\/api\/portfolio\/cards\/([^/]+)$/);
  if (portfolioCardMatch && method === 'PATCH') {
    const updated = await patchPortfolioCard(decodeURIComponent(portfolioCardMatch[1]), await readJsonBody(req));
    return jsonResponse(res, updated ? 200 : 404, updated ? { data: updated } : { error: 'Portfolio card not found' });
  }
  const portfolioSetMatch = url.pathname.match(/^\/api\/portfolio\/sets\/([^/]+)$/);
  if (portfolioSetMatch && method === 'DELETE') {
    const ok = await removePortfolioSet(decodeURIComponent(portfolioSetMatch[1]));
    return jsonResponse(res, ok ? 200 : 404, { ok });
  }

  if (url.pathname === '/api/watchlist' && method === 'GET') return jsonResponse(res, 200, { data: await getWatchlist() });
  if (url.pathname === '/api/watchlist' && method === 'POST') return jsonResponse(res, 201, { data: await upsertWatchItem(await readJsonBody(req)) });
  const watchItemMatch = url.pathname.match(/^\/api\/watchlist\/([^/]+)$/);
  if (watchItemMatch && method === 'PATCH') {
    const item = await patchWatchItem(decodeURIComponent(watchItemMatch[1]), await readJsonBody(req));
    return jsonResponse(res, item ? 200 : 404, item ? { data: item } : { error: 'Watchlist item not found' });
  }
  if (watchItemMatch && method === 'DELETE') {
    const ok = await deleteWatchItem(decodeURIComponent(watchItemMatch[1]));
    return jsonResponse(res, ok ? 200 : 404, { ok });
  }
  if (url.pathname === '/api/ebay/search-url' && method === 'GET') return jsonResponse(res, 200, { url: buildEbaySearchUrl({ query: url.searchParams.get('q') || 'pokemon cards', sold: url.searchParams.get('sold') === 'true' }) });
  if (url.pathname === '/api/deals/scan' && method === 'POST') return jsonResponse(res, 200, await scanDeals(await readJsonBody(req), db.settings));
  if (url.pathname === '/api/watchlist/from-card' && method === 'POST') {
    const body = await readJsonBody(req);
    const card = await getCard(body.cardId, db.settings);
    const item = await upsertWatchItem({ type: 'card', name: card.name, query: card.searchQueries[0] || card.name, queries: card.searchQueries, cardId: card.id, setId: card.set?.id, setName: card.set?.name, number: card.number, image: card.images?.small, rarity: card.rarity, marketPriceGbp: card.marketPriceGbp, marketPriceSource: card.marketPriceSource, collectorStatus: body.collectorStatus || 'wanted' });
    await patchPortfolioCard(card.id, { watch: true, wanted: body.collectorStatus !== 'owned', owned: body.collectorStatus === 'owned' }).catch(() => null);
    return jsonResponse(res, 201, { data: item });
  }
  return jsonResponse(res, 404, { error: 'Route not found' });
}

async function scanDeals(body, settings) {
  const watchlist = await getWatchlist();
  const portfolioTargets = await watchedPortfolioTargets();
  const mode = body.mode || 'watchlist';
  const pages = clampNumber(body.pages, 1, 2, 1);
  const listingType = body.listingType || 'all';
  const condition = body.condition || 'all';
  const maxItems = clampNumber(body.maxItems, 1, 12, settings.maxWatchlistScanItems || 8);
  const maxVariants = clampNumber(body.maxVariants, 1, 5, settings.maxSearchVariantsPerItem || 3);
  const warnings = [];
  let targets = [];
  if (!settings.experimentalEbayScanner) return { data: [], warnings: ['Experimental eBay scanner is disabled in settings.'], generatedSearches: [] };
  if (mode === 'custom') {
    const query = String(body.query || '').trim();
    if (!query) { const error = new Error('Custom scan needs a query'); error.statusCode = 400; throw error; }
    targets = [{ id: 'custom', type: body.type || 'sealed', name: query, query, queries: [query], marketPriceGbp: body.marketPriceGbp ? Number(body.marketPriceGbp) : null, marketPriceSource: body.marketPriceGbp ? 'manual custom target' : null }];
  } else if (mode === 'portfolio') {
    const requestedIds = Array.isArray(body.portfolioCardIds) ? new Set(body.portfolioCardIds) : null;
    targets = portfolioTargets.filter((item) => !requestedIds || requestedIds.has(item.cardId)).slice(0, maxItems);
  } else {
    const allWatchTargets = uniqueBy([...watchlist, ...portfolioTargets], (item) => item.cardId || item.id);
    const requestedIds = Array.isArray(body.watchlistIds) ? new Set(body.watchlistIds) : null;
    targets = allWatchTargets.filter((item) => !requestedIds || requestedIds.has(item.id) || requestedIds.has(item.cardId)).filter((item) => item.status !== 'ignore').slice(0, maxItems);
  }
  const generatedSearches = [];
  const scored = [];
  for (const target of targets) {
    const queries = uniqueBy([...(target.queries || []), target.query, target.name].filter(Boolean), (q) => String(q).toLowerCase()).slice(0, maxVariants);
    for (const query of queries) {
      generatedSearches.push({ targetId: target.id, targetName: target.name, query, url: buildEbaySearchUrl({ query, sold: false, listingType, condition }) });
      const live = await searchEbayExperimental({ query, settings, pages, listingType, condition, sold: false });
      warnings.push(...live.warnings);
      scored.push(...scoreListingsForTarget(live.results, target, settings));
    }
  }
  const data = uniqueBy(scored, (item) => item.itemId || `${item.targetId}-${item.url}`).sort((a, b) => (b.dealPercent ?? -999) - (a.dealPercent ?? -999)).slice(0, 120);
  await addScanHistory({ mode, targetCount: targets.length, resultCount: data.length, generatedSearchCount: generatedSearches.length, warnings: warnings.slice(0, 10) });
  return { data, warnings: [...new Set(warnings)], generatedSearches, scannedTargets: targets.map((target) => ({ id: target.id, name: target.name, marketPriceGbp: target.marketPriceGbp })) };
}

async function serveStatic(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(publicDir, `.${safePath}`);
  if (!resolved.startsWith(publicDir)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const file = await fs.readFile(resolved);
    res.writeHead(200, { 'Content-Type': mimeTypes.get(path.extname(resolved)) || 'application/octet-stream', 'Cache-Control': safePath === '/index.html' ? 'no-store' : 'public, max-age=3600' });
    res.end(file);
  } catch {
    const index = await fs.readFile(path.join(publicDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(index);
  }
}
