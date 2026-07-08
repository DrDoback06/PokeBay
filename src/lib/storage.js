import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDateTime, slugify } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const dataDir = path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'pokebay.local.json');

const defaultDb = {
  version: 1,
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
    experimentalEbayScanner: true
  },
  watchlist: [],
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
    settings: { ...defaultDb.settings, ...(parsed.settings || {}) },
    watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
    scanHistory: Array.isArray(parsed.scanHistory) ? parsed.scanHistory : []
  };
}

export async function writeDb(nextDb) {
  await fs.mkdir(dataDir, { recursive: true });
  const finalDb = { ...nextDb, updatedAt: formatDateTime() };
  await fs.writeFile(dbPath, JSON.stringify(finalDb, null, 2), 'utf8');
  return finalDb;
}

export async function getWatchlist() {
  const db = await readDb();
  return db.watchlist;
}

export async function upsertWatchItem(input) {
  const db = await readDb();
  const now = formatDateTime();
  const id = input.id || `${slugify(input.name || input.query || input.cardId || 'target')}-${Date.now()}`;
  const existingIndex = db.watchlist.findIndex((item) => item.id === id || (input.cardId && item.cardId === input.cardId));
  const item = {
    id: existingIndex >= 0 ? db.watchlist[existingIndex].id : id,
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
    createdAt: existingIndex >= 0 ? db.watchlist[existingIndex].createdAt : now,
    updatedAt: now
  };
  if (existingIndex >= 0) db.watchlist[existingIndex] = { ...db.watchlist[existingIndex], ...item };
  else db.watchlist.unshift(item);
  await writeDb(db);
  return item;
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
  const before = db.watchlist.length;
  db.watchlist = db.watchlist.filter((item) => item.id !== id);
  if (db.watchlist.length === before) return false;
  await writeDb(db);
  return true;
}

export async function addScanHistory(summary) {
  const db = await readDb();
  db.scanHistory.unshift({ id: `scan-${Date.now()}`, createdAt: formatDateTime(), ...summary });
  db.scanHistory = db.scanHistory.slice(0, 25);
  await writeDb(db);
}
