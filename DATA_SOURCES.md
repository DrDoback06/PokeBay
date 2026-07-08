# Data sources and provider strategy

## Free/default providers

### Pokémon TCG API

Used for card search, set search, set card lists, card images, and TCGplayer/Cardmarket price fields where available.

Notes:

- Works without a key, but rate limits are lower.
- Free API key support can be added via `POKEMON_TCG_API_KEY`.
- Cardmarket prices are treated as the best default UK/Europe proxy.
- TCGplayer prices are used as fallback and converted from USD to GBP using static settings.

### eBay UK public search URLs

Used for generated manual search links and experimental public search result parsing.

Notes:

- This is deliberately low-volume and manual-first.
- No eBay account credentials are collected.
- No bids, purchases, messages, watch actions, or seller interactions are automated.
- Parsing can break because eBay changes markup and may challenge requests.

## Enhanced/future providers

### eBay Buy Browse API

Best long-term source for live listing search. Requires eBay developer credentials and OAuth application access token. This should become the preferred provider for stable live listings.

### PriceCharting API

Potentially useful for sealed, graded, and broader collectible pricing. It requires a paid subscription, so it is not part of free mode.

### Manual sealed targets

The MVP sealed-product flow uses manual target prices because sealed product pricing is harder to source reliably for free in the UK.

## Matching philosophy

PokeBay deliberately searches wider than a perfect exact match because the best deals are often imperfect listings.

Examples:

- missing set name;
- wrong card number formatting;
- no rarity term;
- vague title;
- bundle/lot wording;
- misspellings;
- language ambiguity;
- seller uses only Pokémon name and number.

The app flags risk rather than blocking results, because the user makes the final call.
