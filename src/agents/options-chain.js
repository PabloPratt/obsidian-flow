/**
 * Live options chain pricer — Yahoo Finance (15-min delayed).
 * Returns real bid/ask/volume/OI for any ticker + expiry combination.
 * No API key required.
 */

import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/**
 * Fetch all options for a ticker at a given expiry, filtered by price cap.
 * @param {string} ticker
 * @param {string} expiry  'YYYY-MM-DD'
 * @param {'calls'|'puts'|'both'} side
 * @param {number} maxCostPerContract  in dollars (e.g. 100)
 * @param {number} [minVolume]
 */
export async function fetchChain(ticker, expiry, side = 'both', maxCostPerContract = 100, minVolume = 0) {
  const chain = await yf.options(ticker, { date: new Date(expiry) });
  const opts = chain.options?.[0];
  if (!opts) return [];

  const process = (contracts, type) =>
    (contracts ?? [])
      .filter(c => {
        const ask = c.ask ?? c.lastPrice ?? 0;
        return ask > 0 && ask * 100 <= maxCostPerContract && (c.volume ?? 0) >= minVolume;
      })
      .map(c => ({
        symbol:   c.contractSymbol,
        ticker,
        type,
        strike:   c.strike,
        expiry,
        bid:      c.bid,
        ask:      c.ask,
        last:     c.lastPrice,
        costPerContract: Math.round((c.ask ?? c.lastPrice) * 100),
        volume:   c.volume ?? 0,
        oi:       c.openInterest ?? 0,
        iv:       Number(((c.impliedVolatility ?? 0) * 100).toFixed(1)),
        inTheMoney: c.inTheMoney ?? false,
      }));

  const results = [];
  if (side !== 'puts') results.push(...process(opts.calls, 'CALL'));
  if (side !== 'calls') results.push(...process(opts.puts, 'PUT'));
  return results.sort((a, b) => b.volume - a.volume);
}

/**
 * Get available expiry dates for a ticker.
 */
export async function fetchExpiries(ticker) {
  const chain = await yf.options(ticker);
  return (chain.expirationDates ?? []).map(d => d.toISOString().slice(0, 10));
}

/**
 * Price a specific contract by its OCC symbol (e.g. DVN260717C00052500).
 */
export async function priceContract(occSymbol) {
  // Parse OCC symbol: TICKER + YYMMDD + C/P + 8-digit-strike
  const match = occSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
  if (!match) throw new Error(`Invalid OCC symbol: ${occSymbol}`);

  const [, ticker, dateStr, cp, strikeStr] = match;
  const expiry = `20${dateStr.slice(0,2)}-${dateStr.slice(2,4)}-${dateStr.slice(4,6)}`;
  const strike = parseInt(strikeStr, 10) / 1000;
  const side = cp === 'C' ? 'calls' : 'puts';

  const chain = await yf.options(ticker, { date: new Date(expiry) });
  const opts = chain.options?.[0];
  const contracts = cp === 'C' ? opts?.calls : opts?.puts;
  const contract = contracts?.find(c => c.contractSymbol === occSymbol);

  if (!contract) return null;
  return {
    symbol: occSymbol,
    ticker,
    type: cp === 'C' ? 'CALL' : 'PUT',
    strike,
    expiry,
    bid:   contract.bid,
    ask:   contract.ask,
    last:  contract.lastPrice,
    costPerContract: Math.round((contract.ask ?? contract.lastPrice) * 100),
    volume: contract.volume ?? 0,
    oi:     contract.openInterest ?? 0,
    iv:     Number(((contract.impliedVolatility ?? 0) * 100).toFixed(1)),
    inTheMoney: contract.inTheMoney ?? false,
  };
}

/**
 * Scan multiple tickers for cheap options under a budget cap.
 * Used by the orchestrator after getting flow signals.
 */
export async function scanForCheapOptions(tickers, { budget = 100, side = 'both', minVolume = 100 } = {}) {
  const expiriesPerTicker = await Promise.all(
    tickers.map(async t => {
      try {
        const dates = await fetchExpiries(t);
        // Pick next 3 expiries
        return { ticker: t, expiries: dates.slice(0, 3) };
      } catch { return { ticker: t, expiries: [] }; }
    })
  );

  const allResults = [];

  await Promise.all(
    expiriesPerTicker.flatMap(({ ticker, expiries }) =>
      expiries.map(async expiry => {
        try {
          const contracts = await fetchChain(ticker, expiry, side, budget, minVolume);
          allResults.push(...contracts);
        } catch { /* skip */ }
      })
    )
  );

  return allResults.sort((a, b) => b.volume - a.volume);
}
