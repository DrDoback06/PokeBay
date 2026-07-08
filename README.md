# PokeBay

PokeBay is a UK-first Pokémon card and sealed product deal finder for eBay.

It runs as a lightweight Node web app, stores your watchlist/portfolio in a local JSON file, imports full Pokémon set lists from Pokémon TCG API, and generates/scans eBay UK searches experimentally.

## What it does now

- Search Pokémon cards and sets.
- Import a whole set into the Portfolio / Set Tracker.
- Filter imported set cards by name, number, rarity, and tracker status.
- Mark tracker cards as owned, wanted, or watch.
- Add individual cards to the direct watchlist.
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

## Important: Pokémon TCG API key

The app can run without a key, but the no-key Pokémon TCG API limit is much lower and some hosts/IPs may see `403 Forbidden` or rate-limit problems. Get a free key from the Pokémon TCG Developer Portal and add it as:

```bash
POKEMON_TCG_API_KEY=your_key_here
```

Local `.env` files are loaded automatically now, so you can copy `.env.example` to `.env` and restart the app.

For hosted deployment, add `POKEMON_TCG_API_KEY` as an environment variable in the hosting dashboard.

## Optional environment

Copy `.env.example` to `.env` if you want to customise defaults.

```bash
cp .env.example .env
```

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

If eBay blocks or changes the public page markup, PokeBay will still show generated manual search links. For safest long-term use, add official eBay Browse API support and use the experimental scanner only for personal, low-volume research.

## Useful workflow

1. Search a set, for example `Evolving Skies`.
2. Click **Import Whole Set**.
3. Open **Portfolio / Tracker**.
4. Mark owned cards and set watch cards.
5. Scan Watchlist + Portfolio.
6. Open promising eBay links manually.
7. Treat flags as warnings, not blockers.

## Deploying from GitHub

GitHub Pages can host only the static frontend, not the Node API, local JSON storage, or eBay scanner. For the actual app, deploy this repository to a Node host from GitHub, for example Render, Railway, Fly.io, or a VPS.

Use:

```bash
npm install
npm start
```

Set the environment variable `POKEMON_TCG_API_KEY` in your host dashboard.

## Future upgrade path

- Official eBay Browse API provider for stable live listings.
- eBay OAuth app-token flow.
- Optional PriceCharting provider for sealed and graded pricing.
- Smarter sold-listing market estimate provider.
- Import/export watchlists as CSV.
- Better matching for graded/raw/Japanese/English variants.
- Saved searches and notification-ready scan history.
