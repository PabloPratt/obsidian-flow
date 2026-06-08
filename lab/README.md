# Obsidian Flow

Personal options intelligence terminal focused on cheap-but-good options plays.

## Current Build

Static browser prototype for a personal options scanner:

- Local Node proxy server for API attempts and secret-safe future providers
- `.env.local` support for local API keys without exposing them to browser JavaScript
- Options-first scanner with filters for max cost, probability, open interest, IV rank, and direction
- Editable persistent watchlist input
- Hot/Warm/Watch/Not ranking
- 1-10 setup score
- 1-100 probability estimate
- Expected value estimate
- Flow, liquidity, IV, catalyst, and cheap-contract badges
- Manual multi-account entry for Fidelity, Robinhood, Coinbase, Alpaca, and custom accounts
- Manual positions and options plays saved in local browser storage
- Export/import for your manual account book
- Scanner cards flag when a ticker overlaps with your existing holdings or open plays
- Spotlight Picks tracker
- Paper order staging mock

## Run Locally

Best mode:

```bash
npm start
```

Then open:

```text
http://localhost:4173
```

Static fallback:

Open `index.html` directly in a browser. This still works, but live/free data attempts will not run because the browser needs the local proxy.

## Product Direction

The target is a personal Unusual Whales-style workflow without the paid-data dependency at first:

- Find cheap contracts that are actually tradable
- Avoid dead illiquid strikes
- Flag high-IV crush risk instead of hiding it
- Rank contracts by edge, not just low premium
- Track whether the hot calls actually work
- Use manual account and position entry until broker integrations are worth wiring

This is for one personal user, so the app does not need multi-user auth, team permissions, billing, or tenant separation.

## No-Money Mode

No paid APIs are required for the current prototype.

Use this mode while tuning the UX and scoring:

- Manual watchlist
- Manual current holdings and options plays
- Tradier option chains when `TRADIER_TOKEN` is configured, otherwise mock/free normalized contracts
- Local scoring engine
- Local browser storage
- Paper-order staging only

This lets the scanner logic get good before spending money on feeds.

## Accurate Live Data Needs

Accurate live options data is the hard part. Reliable U.S. options quotes come from OPRA-backed feeds, and most complete feeds cost money.

Practical path:

1. Free/manual phase: keep using manual entries and mock data while perfecting the UI and scoring.
2. Chain phase: connect Tradier for option chains, quotes, expirations, greeks, volume, and open interest.
3. Flow phase: connect Unusual Whales for flow-alert context on top of chain data.
4. Streaming phase: add Massive/Polygon websocket feeds for delayed or real-time option messages when the account entitlement supports it.
5. Execution phase: keep paper staging only until scanner quality is proven.

## API Keys

Not needed today.

Useful later:

- `TRADIER_TOKEN`: option chains, quotes, expirations, greeks, volume, and open interest
- `TRADIER_ENV`: `sandbox` or `live`
- `UW_API_KEY` or `UNUSUAL_WHALES_API_KEY`: unusual options flow context
- `MASSIVE_API_KEY` or `POLYGON_API_KEY`: Massive/Polygon options websocket access
- `ALPACA_API_KEY` and `ALPACA_API_SECRET`: paper trading, account positions, and basic market data
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`: agent summaries, play explanations, and scoring notes

## What Is Connected Now

The local server attempts these connections:

- Coinbase public API for crypto spot quotes, no key required
- Unofficial Yahoo Finance quote/options endpoints, no key required, only for prototyping
- Tradier options chains when `TRADIER_TOKEN` exists
- Unusual Whales flow context when `UW_API_KEY` or `UNUSUAL_WHALES_API_KEY` exists
- Massive options websocket stream when `MASSIVE_API_KEY` exists

The app falls back to demo data when a free endpoint is blocked, unavailable, or incomplete.

Important: no-key Yahoo-style endpoints are not a guaranteed data contract. Treat them as prototype data, not final trading-grade data.

Verified in this environment:

- Coinbase public BTC quote: connected
- Yahoo quote/options fallback: unavailable during test
- Alpaca: not connected, missing keys
- Polygon/Massive: not connected, missing key
- Unusual Whales: not connected, missing key

## Clear Setup Steps

1. Start the local app:

```bash
cd /Users/regalia/janus/portfolio-work/obsidian-flow-lab
npm start
```

2. Open the app:

```text
http://localhost:4173
```

3. Add your accounts in the right rail:

- Fidelity account 1
- Fidelity account 2
- Coinbase
- Robinhood
- Any other account you use

4. Enter your current holdings:

- Stocks/ETFs: symbol, quantity, average cost
- Crypto: symbol, quantity, average cost
- Options: symbol plus contract details in the notes field, quantity, average cost

5. Export your book after entering data. This gives you a JSON backup outside browser storage.

6. Enter the tickers you care about in the Watchlist field:

```text
SPY,QQQ,NVDA,AMD,AAPL,TSLA
```

7. Click `Scan Now`.

8. Use the scanner output this way:

- `HOT`: best current setup in this prototype score
- `WARM`: decent but not top tier
- `WATCH`: keep an eye on it
- `NOT`: weak setup or poor trade quality

9. Watch the badges:

- `YOU OWN`: the ticker already exists in your entered book
- `OPEN PLAY`: you already entered an option on that ticker
- `UNDERLYING`: you own the stock or ETF
- `CONCENTRATION`: the app sees multiple or larger entries tied to that ticker

10. Click `Track` for plays you want to monitor.

11. Click `Stage paper order` for a candidate you want to prepare, not execute.

12. Do not connect paid APIs yet. Tune the UI, score weights, and manual workflow first.

## Optional Free/Low-Cost API Steps Later

1. Create an Alpaca account and enable paper trading.
2. Copy the paper API key and secret.
3. Start the server with:

```bash
ALPACA_API_KEY=your_key ALPACA_API_SECRET=your_secret npm start
```

4. Use Alpaca first for paper execution and basic/free data.
5. Add paid OPRA-backed options data only when the scanner is worth spending money on.

Use a local `.env.local` file:

```bash
nano .env.local
```

Then paste keys into `.env.local` and run `npm start`. Do not commit `.env.local`.

## Local Tooling Found

- Node.js `v26.0.0`
- npm `11.16.0`
- Git `2.54.0`
- GitHub CLI installed, but current auth token is invalid
- Vercel CLI `54.7.1`
- Python 3
- Ruby
- Stripe CLI `1.42.1`

Not installed:

- pnpm
- yarn
- bun
- Go
- Rust / Cargo

## Next Build Steps

1. Split the scoring function into a testable module.
2. Add CSV import/export for positions.
3. Add an account/positions endpoint once Alpaca paper keys exist.
4. Add a Massive REST snapshot adapter alongside the websocket stream.
5. Add backtesting on manually tracked Spotlight picks.
