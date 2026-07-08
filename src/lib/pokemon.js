import './env.js';
import { estimateCardMarketPriceGbp } from './pricing.js';
import { uniqueBy } from './utils.js';

const API_ROOT = 'https://api.pokemontcg.io/v2';

async function pokemonFetch(path, params = {}) {
  const url = new URL(`${API_ROOT}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'PokeBay/0.2 (+https://github.com/DrDoback06/PokeBay)'
  };
  if (process.env.POKEMON_TCG_API_KEY) headers['X-Api-Key'] = process.env.POKEMON_TCG_API_KEY;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message || body?.message || '';
    } catch {
      detail = await response.text().catch(() => '');
    }
    const error = new Error(buildPokemonErrorMessage(response.status, detail));
    error.statusCode = response.status === 403 ? 502 : response.status;
    error.providerStatus = response.status;
    error.provider = 'pokemon-tcg-api';
    throw error;
  }
  return response.json();
}

export async function searchCards({ query, pageSize = 24, page = 1, settings = {} }) {
  const q = buildCardSearchQuery(query);
  const result = await pokemonFetch('/cards', {
    q,
    pageSize,
    page,
    orderBy: '-set.releaseDate,number'
  });
  return { ...result, data: (result.data || []).map((card) => normaliseCard(card, settings)) };
}

export async function searchSets({ query, pageSize = 36, page = 1 }) {
  const q = buildSetSearchQuery(query);
  return pokemonFetch('/sets', { q, pageSize, page, orderBy: '-releaseDate' });
}

export async function getSet(setId) {
  const result = await pokemonFetch(`/sets/${encodeURIComponent(setId)}`);
  return result.data;
}

export async function getSetCards({ setId, settings = {} }) {
  const result = await pokemonFetch('/cards', { q: `set.id:${escapeLuceneTerm(setId)}`, pageSize: 250, orderBy: 'number' });
  return { ...result, data: (result.data || []).map((card) => normaliseCard(card, settings)) };
}

export async function getCard(cardId, settings = {}) {
  const result = await pokemonFetch(`/cards/${encodeURIComponent(cardId)}`);
  return normaliseCard(result.data, settings);
}

export function normaliseCard(card, settings = {}) {
  const price = estimateCardMarketPriceGbp(card, settings);
  const queries = buildCardQueries(card);
  return {
    id: card.id,
    name: card.name,
    supertype: card.supertype,
    subtypes: card.subtypes || [],
    number: card.number,
    rarity: card.rarity || null,
    set: card.set ? {
      id: card.set.id,
      name: card.set.name,
      series: card.set.series,
      printedTotal: card.set.printedTotal,
      total: card.set.total,
      releaseDate: card.set.releaseDate,
      ptcgoCode: card.set.ptcgoCode || null,
      images: card.set.images || {}
    } : null,
    images: card.images || {},
    tcgplayer: card.tcgplayer || null,
    cardmarket: card.cardmarket || null,
    marketPriceGbp: price.marketPriceGbp,
    marketPriceSource: price.marketPriceSource,
    searchQueries: queries
  };
}

export function buildCardQueries(card) {
  const name = cleanSearch(card?.name || '');
  const setName = cleanSearch(card?.set?.name || '');
  const number = cleanSearch(card?.number || '');
  const total = card?.set?.printedTotal || card?.set?.total || '';
  const ptcgo = cleanSearch(card?.set?.ptcgoCode || '');
  const rarity = cleanSearch(card?.rarity || '');
  const numberSlash = number && total ? `${number}/${total}` : number;
  const base = [
    `${name} ${setName} ${numberSlash} pokemon card`,
    `${name} ${setName} ${number} pokemon`,
    `${name} ${numberSlash}`,
    `${name} ${ptcgo} ${number}`,
    `${name} ${rarity} pokemon`
  ].filter((q) => q.replace(/\s+/g, '').length > 3);
  const loose = [
    `${name.replace(/-/g, ' ')} pokemon`,
    `${name.replace(/\bex\b/gi, ' ex').replace(/\s+/g, ' ')} ${number}`,
    `${name.split(' ')[0]} ${number} pokemon card`,
    `${name} pokemon card`
  ];
  return uniqueBy([...base, ...loose].map(cleanSearch).filter(Boolean), (q) => q.toLowerCase()).slice(0, 8);
}

function buildCardSearchQuery(query = '') {
  const clean = cleanSearch(query);
  if (!clean) return '';
  const tokens = clean.split(/\s+/).filter(Boolean).slice(0, 5);
  if (tokens.length === 1) return `name:${escapeLuceneTerm(tokens[0])}*`;
  return tokens.map((token) => `name:${escapeLuceneTerm(token)}*`).join(' ');
}

function buildSetSearchQuery(query = '') {
  const clean = cleanSearch(query);
  if (!clean) return '';
  const tokens = clean.split(/\s+/).filter(Boolean).slice(0, 5);
  return tokens.map((token) => `name:${escapeLuceneTerm(token)}*`).join(' ');
}

function cleanSearch(value = '') {
  return String(value).replace(/[™®]/g, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeLuceneTerm(value = '') {
  return String(value).replace(/[+\-!(){}[\]^"~*?:\\/]/g, '\\$&').trim();
}

function buildPokemonErrorMessage(status, detail = '') {
  if (status === 403) {
    return `Pokémon TCG API returned 403 Forbidden. Add a free POKEMON_TCG_API_KEY in your .env or deployment environment, then restart/redeploy. ${detail}`.trim();
  }
  if (status === 429) return 'Pokémon TCG API rate limit hit. Add a free POKEMON_TCG_API_KEY or wait and try again.';
  if (status === 400) return `Pokémon TCG API rejected the search query. Try fewer words. ${detail}`.trim();
  return `Pokémon TCG API failed (${status}). ${detail}`.trim();
}
