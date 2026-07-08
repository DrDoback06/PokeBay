import './env.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDateTime, slugify } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const dataDir = path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'pokebay.local.json');

const defaultDb = {
  version: 2,
  createdAt: null,
  updatedAt: null,
  settings: {
    market: 'UK',
    currency: 'GBP',
    minDealPercent: 15,
    monsterDealPercent: 35,
    maxWatchlistScanItems: 8,
    maxSearchVariantsPerItem: 3,
    ebayThrottleMs: 3200,
    usdToGbp: Number(process.env.POKEBAY_USD_TO_GBP || 0.78),
    eurToGbp: Number(process.env.POKEBAY_EUR_TO_GBP || 0.86),
    experimentalEbayScanner: true,
    pokemonApiKeyConfigured: Boolean(process.env.POKEMON_TCG_API_KEY)
  },
  watchlist: [],
  portfolio: {
    importedSets: []
  },
  scanHistory: []
};

async function ensureDb() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dbPath);
  } catch {
    const now = formatDateTime();
    const initial = { ...defaultDb, createdAt: now, updatedAt: now };
    await fs.writeFile(dbPath, JSON.stringify(initial, null, 2), 'utf8');
  }
}

export async function readDb() {
  await ensureDb();
  const raw = await fs.readFile(dbPath, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    ...defaultDb,
    ...parsed,
    settings: {
      ...defaultDb.settings,
      ...(parsed.settings || {}),
      pokemonApiKeyConfigured: Boolean(process.env.POKEMON_TCG_API_KEY)
    },
    watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
    portfolio: {
      ...defaultDb.portfolio,
      ...(parsed.portfolio || {}),
      importedSets: Array.isArray(parsed?.portfolio?.importedSets) ? parsed.portfolio.importedSets : []
    },
    scanHistory: Array.isArray(parsed.scanHistory) ? parsed.scanHistory : []
  };
}

export async function writeDb(nextDb) {
  await fs.mkdir(dataDir, { recursive: true });
  const finalDb = { ...nextDb, version: 2, updatedAt: formatDateTime() };
  await fs.writeFile(dbPath, JSON.stringify(finalDb, null, 2), 'utf8');
  return finalDb;
}

export async function getWatchlist() {
  const db = await readDb();
  return db.watchlist;
}

export async function upsertWatchItem(input) {
  const db = await readDb();
  const item = normaliseWatchItem(input, db.watchlist);
  const existingIndex = db.watchlist.findIndex((existing) => existing.id === item.id || (item.cardId && existing.cardId === item.cardId));
  if (existingIndex >= 0) db.watchlist[existingIndex] = { ...db.watchlist[existingIndex], ...item, id: db.watchlist[existingIndex].id, createdAt: db.watchlist[existingIndex].createdAt };
  else db.watchlist.unshift(item);
  syncPortfolioWatchFlag(db, item.cardId, true);
  await writeDb(db);
  return existingIndex >= 0 ? db.watchlist[existingIndex] : item;
}

export async function patchWatchItem(id, patch) {
  const db = await readDb();
  const index = db.watchlist.findIndex((item) => item.id === id);
  if (index === -1) return null;
  db.watchlist[index] = { ...db.watchlist[index], ...patch, updatedAt: formatDateTime() };
  await writeDb(db);
  return db.watchlist[index];
}

export async function deleteWatchItem(id) {
  const db = await readDb();
  const removed = db.watchlist.find((item) => item.id === id);
  const before = db.watchlist.length;
  db.watchlist = db.watchlist.filter((item) => item.id !== id);
  if (db.watchlist.length === before) return false;
  if (removed?.cardId && !db.watchlist.some((item) => item.cardId === removed.cardId)) syncPortfolioWatchFlag(db, removed.cardId, false);
  await writeDb(db);
  return true;
}

export async function getPortfolio() {
  const db = await readDb();
  return db.portfolio;
}

export async function importPortfolioSet(set, cards) {
  const db = await readDb();
  const now = formatDateTime();
  const existing = db.portfolio.importedSets.find((entry) => entry.set.id === set.id);
  const existingCardState = new Map((existing?.cards || []).map((card) => [card.id, card.state || {}]));
  const watchByCard = new Set(db.watchlist.filter((item) => item.cardId).map((item) => item.cardId));
  const tracker = {
    id: `set-${set.id}`,
    importedAt: existing?.importedAt || now,
    updatedAt: now,
    set: {
      id: set.id,
      name: set.name,
      series: set.series,
      printedTotal: set.printedTotal || set.total || cards.length,
      total: set.total || cards.length,
      releaseDate: set.releaseDate || null,
      images: set.images || {}
    },
    cards: cards.map((card) => {
      const previous = existingCardState.get(card.id) || {};
      return {
        id: card.id,
        name: card.name,
        number: card.number,
        rarity: card.rarity,
        image: card.images?.small || null,
        marketPriceGbp: card.marketPriceGbp,
        marketPriceSource: card.marketPriceSource,
        searchQueries: card.searchQueries || [],
        state: {
          owned: Boolean(previous.owned),
          wanted: previous.wanted ?? true,
          watch: previous.watch ?? watchByCard.has(card.id),
          notes: previous.notes || ''
        }
      };
    })
  };
  if (existing) Object.assign(existing, tracker);
  else db.portfolio.importedSets.unshift(tracker);
  await writeDb(db);
  return tracker;
}

export async function patchPortfolioCard(cardId, patch) {
  const db = await readDb();
  let updated = null;
  const cleanPatch = Object.fromEntries(Object.entries(patch || {}).filter(([, value]) => value !== undefined));
  for (const tracker of db.portfolio.importedSets) {
    const card = tracker.cards.find((entry) => entry.id === cardId);
    if (!card) continue;
    card.state = { ...card.state, ...cleanPatch, updatedAt: formatDateTime() };
    tracker.updatedAt = formatDateTime();
    updated = { trackerId: tracker.id, set: tracker.set, card };
  }
  if (!updated) return null;
  await writeDb(db);
  return updated;
}

export async function removePortfolioSet(setId) {
  const db = await readDb();
  const before = db.portfolio.importedSets.length;
  db.portfolio.importedSets = db.portfolio.importedSets.filter((entry) => entry.set.id !== setId);
  if (db.portfolio.importedSets.length === before) return false;
  await writeDb(db);
  return true;
}

export async function watchedPortfolioTargets() {
  const db = await readDb();
  const targets = [];
  for (const tracker of db.portfolio.importedSets) {
    for (const card of tracker.cards) {
      if (!card.state?.watch) continue;
      targets.push({
        id: `portfolio-${card.id}`,
        type: 'card',
        name: card.name,
        query: card.searchQueries?.[0] || `${card.name} ${tracker.set.name} ${card.number}`,
        queries: card.searchQueries || [],
        status: 'watching',
        collectorStatus: card.state?.owned ? 'owned' : 'wanted',
        cardId: card.id,
        setId: tracker.set.id,
        setName: tracker.set.name,
        number: card.number,
        image: card.image,
        rarity: card.rarity,
        marketPriceGbp: card.marketPriceGbp,
        marketPriceSource: card.marketPriceSource
      });
    }
  }
  return targets;
}

export async function addScanHistory(summary) {
  const db = await readDb();
  db.scanHistory.unshift({ id: `scan-${Date.now()}`, createdAt: formatDateTime(), ...summary });
  db.scanHistory = db.scanHistory.slice(0, 25);
  await writeDb(db);
}

function normaliseWatchItem(input, existing = []) {
  const now = formatDateTime();
  const id = input.id || `${slugify(input.name || input.query || input.cardId || 'target')}-${Date.now()}`;
  const previous = existing.find((item) => item.id === id || (input.cardId && item.cardId === input.cardId));
  return {
    id: previous?.id || id,
    type: input.type || 'card',
    name: input.name || 'Untitled target',
    query: input.query || input.name || '',
    queries: Array.isArray(input.queries) ? input.queries.slice(0, 8) : [],
    status: input.status || 'watching',
    collectorStatus: input.collectorStatus || 'wanted',
    cardId: input.cardId || null,
    setId: input.setId || null,
    setName: input.setName || null,
    number: input.number || null,
    image: input.image || null,
    rarity: input.rarity || null,
    marketPriceGbp: input.marketPriceGbp ?? null,
    marketPriceSource: input.marketPriceSource || null,
    sealedMeta: input.sealedMeta || null,
    notes: input.notes || '',
    createdAt: previous?.createdAt || now,
    updatedAt: now
  };
}

function syncPortfolioWatchFlag(db, cardId, watch) {
  if (!cardId) return;
  for (const tracker of db.portfolio.importedSets) {
    const card = tracker.cards.find((entry) => entry.id === cardId);
    if (card) card.state = { ...card.state, watch, updatedAt: formatDateTime() };
  }
}
