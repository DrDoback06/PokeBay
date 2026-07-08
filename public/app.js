const state = { settings: null, watchlist: [], portfolio: { importedSets: [] }, generatedSearches: [] };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

init().catch((error) => status(`Startup error: ${error.message}`, true));

async function init() {
  bindTabs();
  bindForms();
  await Promise.all([loadSettings(), loadWatchlist(), loadPortfolio()]);
}

function bindTabs() {
  $$('.tab').forEach((button) => button.addEventListener('click', () => {
    $$('.tab').forEach((tab) => tab.classList.remove('active'));
    $$('.panel').forEach((panel) => panel.classList.remove('active-panel'));
    button.classList.add('active');
    $(`#tab-${button.dataset.tab}`).classList.add('active-panel');
  }));
}

function bindForms() {
  $('#card-search-form').addEventListener('submit', async (event) => { event.preventDefault(); await searchCards($('#card-query').value.trim()); });
  $('#set-search-form').addEventListener('submit', async (event) => { event.preventDefault(); await searchSets($('#set-query').value.trim()); });
  $('#sealed-form').addEventListener('submit', async (event) => { event.preventDefault(); await addSealed(); });
  $('#scan-watchlist').addEventListener('click', () => scanWatchlist());
  $('#scan-custom').addEventListener('click', scanCustom);
  $('#copy-searches').addEventListener('click', copySearches);
  $('#refresh-portfolio').addEventListener('click', loadPortfolio);
  $('#portfolio-filter').addEventListener('input', renderPortfolio);
  $('#portfolio-status').addEventListener('change', renderPortfolio);
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `Request failed: ${response.status}`);
  return json;
}

async function loadSettings() {
  state.settings = await api('/api/settings');
  $('#settings-output').innerHTML = `<p class="meta">Market: <b>${state.settings.market}</b> · Currency: <b>${state.settings.currency}</b> · Minimum deal: <b>${state.settings.minDealPercent}%</b> · Monster: <b>${state.settings.monsterDealPercent}%</b></p><p class="meta">Pokémon API key configured: <b>${state.settings.pokemonApiKeyConfigured ? 'yes' : 'no'}</b>. Static FX fallback: USD→GBP ${state.settings.usdToGbp}, EUR→GBP ${state.settings.eurToGbp}. eBay throttle: ${state.settings.ebayThrottleMs}ms.</p>`;
}

async function loadWatchlist() {
  const result = await api('/api/watchlist');
  state.watchlist = result.data || [];
  renderWatchlist();
}

async function loadPortfolio() {
  const result = await api('/api/portfolio');
  state.portfolio = result.data || { importedSets: [] };
  renderPortfolio();
}

function renderWatchlist() {
  const container = $('#watchlist-items');
  if (!state.watchlist.length) {
    container.innerHTML = empty('No direct watchlist targets yet. Add cards from Card Search/Set Tracker, or add sealed products.');
    return;
  }
  container.innerHTML = state.watchlist.map((item) => `<article class="watch">${item.image ? `<img class="thumb" src="${h(item.image)}" alt="${h(item.name)}"/>` : '<div class="thumb"></div>'}<div><h3>${h(item.name)}</h3><p class="meta">${h(item.type)} · ${item.setName ? `${h(item.setName)} · ` : ''}${item.number ? `#${h(item.number)} · ` : ''}${item.marketPriceGbp ? `market £${money(item.marketPriceGbp)}` : 'no market price'}</p><p class="meta">Query: ${h(item.query || item.name)}</p></div><div><button class="secondary" data-scan="${h(item.id)}">Scan</button> <button class="danger" data-remove="${h(item.id)}">Remove</button></div></article>`).join('');
  $$('[data-remove]').forEach((button) => button.addEventListener('click', async () => { await api(`/api/watchlist/${encodeURIComponent(button.dataset.remove)}`, { method: 'DELETE' }); await Promise.all([loadWatchlist(), loadPortfolio()]); }));
  $$('[data-scan]').forEach((button) => button.addEventListener('click', () => scanWatchlist([button.dataset.scan])));
}

function renderPortfolio() {
  const container = $('#portfolio-output');
  const importedSets = state.portfolio?.importedSets || [];
  if (!importedSets.length) {
    container.innerHTML = empty('No imported sets yet. Go to Import Sets, search a set, then click Import Whole Set.');
    return;
  }
  const filter = ($('#portfolio-filter').value || '').trim().toLowerCase();
  const statusFilter = $('#portfolio-status').value;
  container.innerHTML = importedSets.map((tracker) => trackerTpl(tracker, filter, statusFilter)).join('');
  $$('[data-owned]').forEach((button) => button.addEventListener('click', () => togglePortfolioCard(button.dataset.owned, { owned: button.dataset.value !== 'true' })));
  $$('[data-wanted]').forEach((button) => button.addEventListener('click', () => togglePortfolioCard(button.dataset.wanted, { wanted: button.dataset.value !== 'true' })));
  $$('[data-watch-card]').forEach((button) => button.addEventListener('click', () => toggleWatchCard(button.dataset.watchCard, button.dataset.value !== 'true')));
  $$('[data-remove-set]').forEach((button) => button.addEventListener('click', async () => { await api(`/api/portfolio/sets/${encodeURIComponent(button.dataset.removeSet)}`, { method: 'DELETE' }); await loadPortfolio(); }));
  $$('[data-scan-card]').forEach((button) => button.addEventListener('click', () => scanWatchlist([button.dataset.scanCard])));
}

function trackerTpl(tracker, filter, statusFilter) {
  const cards = filteredTrackerCards(tracker.cards || [], filter, statusFilter);
  const owned = (tracker.cards || []).filter((card) => card.state?.owned).length;
  const wanted = (tracker.cards || []).filter((card) => card.state?.wanted).length;
  const watching = (tracker.cards || []).filter((card) => card.state?.watch).length;
  const total = tracker.cards?.length || 0;
  const progress = total ? Math.round((owned / total) * 100) : 0;
  return `<section class="tracker"><div class="tracker-head"><div>${tracker.set.images?.logo ? `<img src="${h(tracker.set.images.logo)}" alt="${h(tracker.set.name)}"/>` : ''}<h3>${h(tracker.set.name)}</h3><p class="meta">${h(tracker.set.series || '')} · ${h(tracker.set.releaseDate || '')} · ${owned}/${total} owned (${progress}%) · ${wanted} wanted · ${watching} watching</p></div><div><button class="danger" data-remove-set="${h(tracker.set.id)}">Remove Set</button></div></div><div class="progress"><span style="width:${progress}%"></span></div><div class="tracker-cards">${cards.length ? cards.map((card) => portfolioCardTpl(card, tracker.set)).join('') : empty('No cards match this filter.')}</div></section>`;
}

function filteredTrackerCards(cards, filter, statusFilter) {
  return cards.filter((card) => {
    const haystack = `${card.name} ${card.number} ${card.rarity}`.toLowerCase();
    if (filter && !haystack.includes(filter)) return false;
    if (statusFilter === 'watch' && !card.state?.watch) return false;
    if (statusFilter === 'wanted' && !card.state?.wanted) return false;
    if (statusFilter === 'owned' && !card.state?.owned) return false;
    if (statusFilter === 'missing' && card.state?.owned) return false;
    return true;
  });
}

function portfolioCardTpl(card, set) {
  return `<article class="portfolio-card ${card.state?.watch ? 'is-watching' : ''}">${card.image ? `<img src="${h(card.image)}" alt="${h(card.name)}"/>` : ''}<div><h4>${h(card.name)}</h4><p class="meta">#${h(card.number || '?')} · ${h(card.rarity || 'unknown')} · ${card.marketPriceGbp ? `£${money(card.marketPriceGbp)}` : 'no price'}</p><p class="meta">${h(card.marketPriceSource || '')}</p><div class="mini-actions"><button class="ghost ${card.state?.owned ? 'selected' : ''}" data-owned="${h(card.id)}" data-value="${card.state?.owned ? 'true' : 'false'}">${card.state?.owned ? 'Owned' : 'Mark Owned'}</button><button class="ghost ${card.state?.wanted ? 'selected' : ''}" data-wanted="${h(card.id)}" data-value="${card.state?.wanted ? 'true' : 'false'}">${card.state?.wanted ? 'Wanted' : 'Want'}</button><button class="secondary" data-watch-card="${h(card.id)}" data-value="${card.state?.watch ? 'true' : 'false'}">${card.state?.watch ? 'Watching' : 'Watch'}</button><button class="ghost" data-scan-card="portfolio-${h(card.id)}">Scan</button><a class="ghost" href="${h(ebayUrl((card.searchQueries || [])[0] || `${card.name} ${set.name} ${card.number}`))}" target="_blank" rel="noreferrer">eBay</a></div></div></article>`;
}

async function togglePortfolioCard(cardId, patch) {
  await api(`/api/portfolio/cards/${encodeURIComponent(cardId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  await loadPortfolio();
}

async function toggleWatchCard(cardId, watch) {
  await api(`/api/portfolio/cards/${encodeURIComponent(cardId)}`, { method: 'PATCH', body: JSON.stringify({ watch, wanted: watch ? true : undefined }) });
  if (watch) {
    const entry = findPortfolioCard(cardId);
    if (entry) {
      await api('/api/watchlist', { method: 'POST', body: JSON.stringify({ type: 'card', name: entry.card.name, query: entry.card.searchQueries?.[0] || `${entry.card.name} ${entry.set.name} ${entry.card.number}`, queries: entry.card.searchQueries || [], cardId: entry.card.id, setId: entry.set.id, setName: entry.set.name, number: entry.card.number, image: entry.card.image, rarity: entry.card.rarity, marketPriceGbp: entry.card.marketPriceGbp, marketPriceSource: entry.card.marketPriceSource, collectorStatus: entry.card.state?.owned ? 'owned' : 'wanted' }) });
    }
  } else {
    const existing = state.watchlist.find((item) => item.cardId === cardId);
    if (existing) await api(`/api/watchlist/${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
  }
  await Promise.all([loadPortfolio(), loadWatchlist()]);
}

function findPortfolioCard(cardId) {
  for (const tracker of state.portfolio.importedSets || []) {
    const card = tracker.cards.find((entry) => entry.id === cardId);
    if (card) return { set: tracker.set, card };
  }
  return null;
}

async function searchCards(query) {
  const container = $('#card-results');
  container.innerHTML = empty('Searching cards...');
  try {
    const result = await api(`/api/cards/search?q=${encodeURIComponent(query)}&pageSize=24`);
    const cards = result.data || [];
    container.innerHTML = cards.length ? cards.map(cardTpl).join('') : empty('No cards found. Try fewer words, e.g. Charizard rather than the full title.');
    bindAddButtons(container);
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

async function searchSets(query) {
  const container = $('#set-results');
  $('#set-cards').innerHTML = '';
  container.innerHTML = empty('Searching sets...');
  try {
    const result = await api(`/api/sets/search?q=${encodeURIComponent(query)}&pageSize=36`);
    const sets = result.data || [];
    container.innerHTML = sets.length ? sets.map((set) => `<article class="set card">${set.images?.logo ? `<img src="${h(set.images.logo)}" alt="${h(set.name)} logo"/>` : ''}<h3>${h(set.name)}</h3><p class="meta">${h(set.series || '')} · ${h(set.releaseDate || 'unknown')} · ${set.printedTotal || set.total || '?'} cards</p><button class="primary" data-import-set="${h(set.id)}">Import Whole Set</button> <button class="secondary" data-set="${h(set.id)}">Preview Cards</button></article>`).join('') : empty('No sets found.');
    $$('[data-set]').forEach((button) => button.addEventListener('click', () => openSet(button.dataset.set)));
    $$('[data-import-set]').forEach((button) => button.addEventListener('click', () => importSet(button.dataset.importSet, button)));
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

async function importSet(setId, button) {
  button.disabled = true;
  button.textContent = 'Importing...';
  try {
    await api('/api/portfolio/import-set', { method: 'POST', body: JSON.stringify({ setId }) });
    await loadPortfolio();
    button.textContent = 'Imported';
    document.querySelector('[data-tab="portfolio"]').click();
  } catch (error) {
    button.disabled = false;
    button.textContent = error.message;
  }
}

async function openSet(id) {
  const container = $('#set-cards');
  container.innerHTML = empty('Loading set cards...');
  try {
    const result = await api(`/api/sets/${encodeURIComponent(id)}/cards`);
    container.innerHTML = (result.data || []).map(cardTpl).join('');
    bindAddButtons(container);
  } catch (error) {
    container.innerHTML = empty(error.message);
  }
}

function cardTpl(card) {
  return `<article class="card">${card.images?.small ? `<img src="${h(card.images.small)}" alt="${h(card.name)}"/>` : ''}<h3>${h(card.name)}</h3><span class="pill">${card.marketPriceGbp ? `£${money(card.marketPriceGbp)} est.` : 'No price'}</span><p class="meta">${h(card.set?.name || '')} · #${h(card.number || '?')} · ${h(card.rarity || 'unknown')}</p><p class="meta">${h(card.marketPriceSource || 'No source')}</p><button class="primary" data-add-card="${h(card.id)}">Add to Watchlist</button> <a class="ghost" href="${h(ebayUrl((card.searchQueries || [card.name])[0]))}" target="_blank" rel="noreferrer">Open eBay</a></article>`;
}

function bindAddButtons(scope) {
  scope.querySelectorAll('[data-add-card]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Adding...';
    try {
      await api('/api/watchlist/from-card', { method: 'POST', body: JSON.stringify({ cardId: button.dataset.addCard, collectorStatus: 'wanted' }) });
      await Promise.all([loadWatchlist(), loadPortfolio()]);
      button.textContent = 'Added';
    } catch (error) {
      button.disabled = false;
      button.textContent = error.message;
    }
  }));
}

async function addSealed() {
  const name = $('#sealed-name').value.trim();
  const query = $('#sealed-query').value.trim();
  await api('/api/watchlist', { method: 'POST', body: JSON.stringify({ type: 'sealed', name, query, queries: [query, `${name} sealed pokemon`, `${name} uk`], marketPriceGbp: Number($('#sealed-market').value), marketPriceSource: 'manual sealed target', notes: $('#sealed-notes').value.trim(), sealedMeta: { addedFrom: 'sealed-form' } }) });
  $('#sealed-form').reset();
  await loadWatchlist();
  status(`Added sealed target: ${name}`);
}

async function scanWatchlist(ids = null) {
  status('Scanning eBay UK carefully. Requests are throttled.');
  $('#deal-results').innerHTML = empty('Scanning live listings...');
  try {
    renderScan(await api('/api/deals/scan', { method: 'POST', body: JSON.stringify({ mode: 'watchlist', watchlistIds: ids, listingType: $('#listing-type').value, condition: $('#condition').value, pages: 1, maxVariants: 3 }) }));
  } catch (error) {
    $('#deal-results').innerHTML = empty(error.message);
    status(error.message, true);
  }
}

async function scanCustom() {
  const query = $('#custom-query').value.trim();
  if (!query) return status('Add a custom query first.', true);
  status('Scanning custom query...');
  $('#deal-results').innerHTML = empty('Scanning live listings...');
  try {
    renderScan(await api('/api/deals/scan', { method: 'POST', body: JSON.stringify({ mode: 'custom', query, marketPriceGbp: $('#custom-market').value, listingType: $('#listing-type').value, condition: $('#condition').value, pages: 1 }) }));
  } catch (error) {
    $('#deal-results').innerHTML = empty(error.message);
    status(error.message, true);
  }
}

function renderScan(result) {
  state.generatedSearches = result.generatedSearches || [];
  renderSearches();
  status(`Found ${(result.data || []).length} listings.${result.warnings?.length ? ` Warnings: ${result.warnings.join(' | ')}` : ''}`, Boolean(result.warnings?.length));
  $('#deal-results').innerHTML = (result.data || []).length ? (result.data || []).map(dealTpl).join('') : empty('No listings parsed. Use the generated eBay links manually or try a broader query.');
}

function renderSearches() {
  const box = $('#generated-searches');
  if (!state.generatedSearches.length) { box.classList.remove('active'); box.innerHTML = ''; return; }
  box.classList.add('active');
  box.innerHTML = `<b>Generated eBay searches</b>${state.generatedSearches.slice(0, 40).map((item) => `<a href="${h(item.url)}" target="_blank" rel="noreferrer">${h(item.targetName || 'Custom')}: ${h(item.query)}</a>`).join('')}`;
}

function dealTpl(item) {
  const percent = item.dealPercent == null ? '—' : `${item.dealPercent}%`;
  const flags = item.flags?.length ? `<div class="flags">${item.flags.map((flag) => `<span class="flag">${h(flag)}</span>`).join('')}</div>` : '';
  return `<article class="deal">${item.image ? `<img src="${h(item.image)}" alt="${h(item.title)}"/>` : '<div></div>'}<div><a class="title" href="${h(item.url)}" target="_blank" rel="noreferrer"><b>${h(item.title)}</b></a><p class="meta">Target: ${h(item.targetName || 'Custom')} · Match ${item.titleMatchScore || 0}%</p><p class="meta">Listing £${money(item.priceGbp)} + postage £${money(item.shippingGbp)} = <b>£${money(item.totalPriceGbp)}</b>${item.marketPriceGbp ? ` · Market £${money(item.marketPriceGbp)}` : ''}</p>${flags}</div><div class="score rating-${item.rating || 'unknown'}"><strong>${percent}</strong><span>${h(item.label || 'Unknown')}</span>${item.savingGbp ? `<p class="meta">Save £${money(item.savingGbp)}</p>` : ''}</div></article>`;
}

async function copySearches() {
  const text = state.generatedSearches.map((item) => `${item.targetName || 'Custom'} | ${item.query} | ${item.url}`).join('\n');
  if (!text) return status('No generated searches yet.', true);
  await navigator.clipboard.writeText(text);
  status('Generated searches copied.');
}

function ebayUrl(query) {
  const url = new URL('https://www.ebay.co.uk/sch/i.html');
  url.searchParams.set('_nkw', query || 'pokemon card');
  url.searchParams.set('_sop', '1');
  url.searchParams.set('LH_PrefLoc', '1');
  return url.toString();
}

function status(message, warning = false) { const s = $('#deal-status'); s.textContent = message; s.style.color = warning ? 'var(--warn)' : 'var(--muted)'; }
function empty(message) { return `<div class="empty">${h(message)}</div>`; }
function money(value) { const number = Number(value); return Number.isFinite(number) ? number.toFixed(2) : '0.00'; }
function h(value = '') { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
