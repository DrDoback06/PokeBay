# PokeBay

PokeBay is a UK-first, local-only Pokémon card and sealed product deal finder for eBay.

It runs as a lightweight Node web app, stores your watchlist in a local JSON file, pulls card/set data from Pokémon TCG API, and generates/scans eBay UK searches experimentally.

## What it does now

- Search Pokémon cards and sets.
- Open a set tracker and add chase cards to a watchlist.
- Add sealed product targets with a manual market price.
- Generate multiple eBay UK search variants per watched card.
- Experimentally scan public eBay UK search result pages.
- Score possible deals with a percentage indicator.
- Flag risky listings such as proxy/custom, damaged, bundle/lot, stock-image, graded/slab, language mismatch, empty packaging, or possible reseal.
- Keep buying manual: open eBay links yourself in your own browser.

## What it intentionally does not do

- It does not ask for your eBay login.
- It does not scrape behind a logged-in eBay account.
- It does not bid, buy, watch, message sellers, or automate account actions.
- It does not try to bypass CAPTCHA, bot checks, or access controls.
- It does not guarantee eBay parsing will always work. eBay markup changes and may block automated requests.

## Run locally

Requires Node 20+.

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

There are currently no package dependencies, so `npm install` is mostly there for standard project workflow.

## Optional environment

Copy `.env.example` to `.env` if you want to customise defaults.

```bash
cp .env.example .env
```

The MVP runs without API keys. A Pokémon TCG API key can be added later for better rate limits. eBay API credentials are reserved for a future official-provider mode.

## Deal scoring

```text
deal % = (market price - listing total) / market price × 100
listing total = item price + postage
```

Default labels:

- 35%+ below market: Monster deal
- 25–34.9% below market: Strong deal
- 15–24.9% below market: Worth checking
- 0–14.9% below market: Fair price
- Below 0%: Above market

## Pricing source strategy

For cards, PokeBay uses Pokémon TCG API data and prefers European Cardmarket fields when available, then falls back to TCGplayer fields. Because this is UK-first and free-mode, prices are converted to GBP using static fallback rates in settings.

For sealed items, free reliable pricing is weaker, so the MVP uses your manual target market price. Enhanced provider support can be added later for paid or official sources.

## eBay safety model

PokeBay is designed as a research helper, not an account bot.

The experimental scanner:

- searches public eBay UK result pages only;
- uses a clear user agent;
- throttles requests;
- caps pages and watchlist scans;
- caches repeat searches briefly;
- returns manual links for you to inspect yourself.

For safest long-term use, add official eBay Browse API support and use the experimental scanner only for personal, low-volume research.

## Useful workflow

1. Search a set, for example `Evolving Skies`.
2. Add chase cards to Watchlist.
3. Add sealed targets manually with a realistic market price.
4. Scan Watchlist.
5. Open promising eBay links manually.
6. Treat flags as warnings, not blockers.

## Future upgrade path

- Official eBay Browse API provider for live listings.
- eBay OAuth app-token flow.
- Optional PriceCharting provider for sealed and graded pricing.
- Smarter sold-listing market estimate provider.
- Import/export watchlists as CSV.
- Better matching for graded/raw/Japanese/English variants.
- Saved searches and notification-ready scan history.
