import { config } from '../config.js';

/**
 * Fetches unusual options flow from Unusual Whales REST API.
 * Focuses on golden sweeps (ask-side, high premium) as primary smart-money signal.
 */
export async function fetchOptionsFlow({ minPremium = 500_000, focusTickers = [], limit = 30 } = {}) {
  const params = new URLSearchParams({
    is_sweep: 'true',
    is_ask_side: 'true',
    min_premium: String(minPremium),
    limit: String(limit),
  });

  if (focusTickers.length) params.set('ticker_symbol', focusTickers.join(','));

  const res = await fetch(`${config.unusualWhales.baseUrl}/option-trades/flow-alerts?${params}`, {
    headers: { Authorization: `Bearer ${config.unusualWhales.apiKey}` },
  });

  if (!res.ok) throw new Error(`Unusual Whales API error: ${res.status}`);
  const { data: result } = await res.json();

  const signals = result.map(flow => ({
    ticker: flow.ticker,
    contract: flow.option_chain,
    type: flow.type,
    direction: flow.type === 'call' ? 'bullish' : 'bearish',
    premium: Number(flow.total_premium),
    askSidePremium: Number(flow.total_ask_side_prem),
    askSideRatio: Number(flow.total_ask_side_prem) / Number(flow.total_premium),
    strike: flow.strike,
    expiry: flow.expiry,
    daysToExpiry: Math.round((new Date(flow.expiry) - Date.now()) / 86_400_000),
    underlyingPrice: flow.underlying_price,
    volume: flow.volume,
    openInterest: flow.open_interest,
    volumeOiRatio: Number(flow.volume_oi_ratio),
    rule: flow.alert_rule,
    sector: flow.sector,
    nextEarnings: flow.next_earnings_date,
    tradeCount: flow.trade_count,
    timestamp: flow.created_at,
  }));

  // Conviction score: weighted by premium size, ask-side ratio, and trade count
  signals.forEach(s => {
    s.conviction = Math.min(1, (s.askSidePremium / 5_000_000) * s.askSideRatio * Math.log10(s.tradeCount + 1));
  });

  signals.sort((a, b) => b.conviction - a.conviction);

  return { source: 'unusual_whales', signals, fetchedAt: new Date().toISOString() };
}
