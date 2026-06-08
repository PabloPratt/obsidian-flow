# Obsidian Flow Options Engine Brief

## North Star

Rank options plays from hot to not.

The scanner must answer three questions fast:

- How good is this play on a 1-10 scale?
- What is the probability estimate on a 1-100 scale?
- Why is it hot, warm, watch-only, or not worth touching?

## Personal Scope

This is a one-user terminal. Optimize for the owner's accounts and workflow:

- Multiple Fidelity accounts
- Coinbase
- Robinhood
- Alpaca or other paper trading
- Manual entry first
- Broker/API sync later

No multi-user auth, billing, or tenant architecture is required.

## Hard Filters

Exclude a contract when it fails any selected gate:

- Cost above max contract debit
- Open interest below minimum
- Probability estimate below minimum
- IV rank above max, unless the user explicitly allows high-IV plays
- Direction mismatch

## Score Model

Composite score, 0-100 internally and displayed as 1-10:

- Flow confirmation: 30%
- Probability/delta: 20%
- Liquidity: 15%
- IV positioning: 15%
- Risk-reward / expected value: 15%
- Catalyst alignment: 5%

Also display:

- Heat label: HOT, WARM, WATCH, NOT
- Probability percentage
- Expected value
- Debit
- Delta
- IV rank
- OI and volume
- Reason badges

## Badges

- `FLOW BACKED`
- `LIQUID`
- `HIGH IV`
- `CATALYST`
- `UNDER $100`
- `WIDE SPREAD`

## No-Money Mode

Start with:

- Manual accounts
- Manual holdings/options plays
- Manual or mock watchlist
- Mock contracts
- Local browser storage
- No paid API dependencies

The goal is to perfect the UX, ranking language, scoring weights, and accountability loop before paying for data.

## Live Data Adapter Plan

Later, add adapters without changing UI components:

```js
async function getOptionsCandidates(tickers, filters) {
  return [
    {
      ticker,
      type,
      strike,
      expiry,
      ask,
      bid,
      mid,
      delta,
      ivRank,
      oi,
      volume,
      flow,
      catalyst,
      targetMove,
      expectedPayoff,
    },
  ];
}
```

## API Priority

1. Alpaca Basic: free start, paper trading, limited market data.
2. Polygon/Massive or another OPRA-backed provider: accurate options chain/greeks/IV/OI.
3. Unusual Whales API/MCP: flow, dark pool, GEX, and richer options intelligence.
4. OpenAI: explanations, JANUS agent summaries, and play writeups.

## Definition Of Done For First Prototype

- Options scanner is the default screen.
- Every candidate shows Hot/Not, 1-10 score, probability percentage, debit, EV, IV rank, OI, and badges.
- User can enter multiple accounts.
- User can enter current stocks, crypto, options, and open plays.
- User can track a pick in Spotlight.
- User can stage a paper order.
- Browser reload keeps personal book data through local storage.
