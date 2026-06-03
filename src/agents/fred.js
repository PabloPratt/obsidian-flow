/**
 * FRED (Federal Reserve Economic Data) agent — macro regime signals:
 *  - Fed Funds Rate        → rate trajectory (risk-on/risk-off)
 *  - 10Y-2Y Yield Spread   → recession indicator
 *  - CPI YoY               → inflation regime
 *  - Unemployment Rate     → economic health
 *  - M2 Money Supply       → liquidity conditions
 *  - VIX (via FRED)        → fear gauge
 *
 * Free API key: https://fred.stlouisfed.org/docs/api/api_key.html
 */

import { config } from '../config.js';

const BASE = 'https://api.stlouisfed.org/fred/series/observations';

const SERIES = {
  DFF:     { name: 'Fed Funds Rate',           unit: '%',    marketMeaning: 'Higher = tighter conditions, risk-off' },
  T10Y2Y:  { name: '10Y-2Y Yield Spread',      unit: '%',    marketMeaning: 'Negative = inverted curve, recession warning' },
  CPIAUCSL:{ name: 'CPI (All Urban)',          unit: 'index',marketMeaning: 'Rising YoY = inflationary, Fed hawkish' },
  UNRATE:  { name: 'Unemployment Rate',        unit: '%',    marketMeaning: 'Rising = slowdown; triggers Fed easing' },
  M2SL:    { name: 'M2 Money Supply',          unit: '$B',   marketMeaning: 'Expanding = liquidity tailwind for equities' },
  DCOILWTICO: { name: 'WTI Crude Oil Price',   unit: '$/bbl',marketMeaning: 'Rising = energy inflation, XOM/CVX bullish' },
  BAMLH0A0HYM2: { name: 'HY Credit Spread',   unit: '%',    marketMeaning: 'Widening = credit stress, risk-off' },
};

async function fetchSeries(seriesId, apiKey, limit = 3) {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: String(limit),
    observation_start: new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10),
  });

  const res = await fetch(`${BASE}?${params}`);
  if (!res.ok) throw new Error(`FRED ${seriesId} error: ${res.status}`);
  const data = await res.json();
  return data.observations ?? [];
}

export async function fetchFREDSignals() {
  if (!config.fred?.apiKey) {
    return {
      source: 'fred',
      configured: false,
      message: 'Set FRED_API_KEY in .env. Free registration at fred.stlouisfed.org — instant approval.',
      indicators: {},
      fetchedAt: new Date().toISOString(),
    };
  }

  const results = await Promise.allSettled(
    Object.keys(SERIES).map(async id => {
      const obs = await fetchSeries(id, config.fred.apiKey);
      const latest = obs.find(o => o.value !== '.');
      const prior = obs.find((o, i) => i > 0 && o.value !== '.');

      const latestVal = latest ? Number(latest.value) : null;
      const priorVal = prior ? Number(prior.value) : null;
      const change = latestVal !== null && priorVal !== null ? latestVal - priorVal : null;

      return {
        seriesId: id,
        name: SERIES[id].name,
        unit: SERIES[id].unit,
        marketMeaning: SERIES[id].marketMeaning,
        latestValue: latestVal,
        latestDate: latest?.date,
        priorValue: priorVal,
        change: change ? Number(change.toFixed(4)) : null,
        trend: change === null ? 'unknown' : change > 0 ? 'rising' : change < 0 ? 'falling' : 'flat',
      };
    })
  );

  const indicators = {};
  results.forEach((r, i) => {
    const id = Object.keys(SERIES)[i];
    indicators[id] = r.status === 'fulfilled' ? r.value : { error: r.reason?.message };
  });

  // Derive macro regime
  const fedFunds = indicators.DFF?.latestValue;
  const yieldSpread = indicators.T10Y2Y?.latestValue;
  const hySpread = indicators.BAMLH0A0HYM2?.latestValue;

  let macroRegime = 'unknown';
  if (fedFunds !== null && yieldSpread !== null) {
    if (yieldSpread < 0 && hySpread > 4) macroRegime = 'late_cycle_stress';
    else if (yieldSpread < 0) macroRegime = 'inverted_curve';
    else if (fedFunds > 4) macroRegime = 'restrictive';
    else macroRegime = 'accommodative';
  }

  return {
    source: 'fred',
    configured: true,
    macroRegime,
    indicators,
    fetchedAt: new Date().toISOString(),
  };
}
