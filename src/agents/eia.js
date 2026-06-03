/**
 * EIA (Energy Information Administration) agent — energy market signals:
 *  - Crude oil weekly inventory (drawdown = bullish oil)
 *  - Natural gas storage (below 5yr avg = bullish gas)
 *  - Gasoline/distillate stocks
 *  - Refinery utilization rate
 *
 * Free API key: https://www.eia.gov/opendata/register.php (instant)
 */

import { config } from '../config.js';

const BASE = 'https://api.eia.gov/v2';

// EIA series IDs for key energy data
const SERIES = {
  crude_inventory:   { id: 'PET.WCRSTUS1.W',  name: 'US Crude Oil Inventories (MMbbl)',      bullishWhen: 'draw > 2 MMbbl = bullish oil' },
  natgas_storage:    { id: 'NG.NW2_EPG0_SWO_R48_BCF.W', name: 'Natural Gas Storage (Bcf)',  bullishWhen: 'below 5yr avg = bullish NG' },
  gasoline_stock:    { id: 'PET.WGTSTUS1.W',  name: 'Gasoline Stocks (MMbbl)',               bullishWhen: 'draw = bullish crack spreads' },
  refinery_util:     { id: 'PET.WPULEUS2.W',  name: 'Refinery Utilization Rate (%)',         bullishWhen: '>90% = tight capacity' },
  wti_spot:          { id: 'PET.RWTC.D',       name: 'WTI Crude Spot Price ($/bbl)',          bullishWhen: 'trending up YoY' },
};

const ENERGY_TICKERS = {
  oil_bullish:  ['XOM', 'CVX', 'COP', 'OXY', 'MPC', 'PSX'],
  oil_bearish:  ['DAL', 'UAL', 'AAL', 'FDX'],
  natgas_bull:  ['EQT', 'AR', 'RRC', 'SWN', 'CTRA'],
  refining:     ['MPC', 'VLO', 'PSX', 'DK'],
};

async function fetchEIASeries(seriesId, limit = 4) {
  if (!config.eia?.apiKey) return null;

  // EIA v2 backward-compatibility endpoint for v1 series IDs
  const url = `https://api.eia.gov/v2/seriesid/${seriesId}?api_key=${config.eia.apiKey}&data[]=value&sort[0][column]=period&sort[0][direction]=desc&length=${limit}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const json = await res.json();
  const rows = json.response?.data ?? [];
  return rows.map(r => ({ date: r.period, value: Number(r.value) }));
}

export async function fetchEIASignals() {
  if (!config.eia?.apiKey) {
    return {
      source: 'eia',
      configured: false,
      message: 'Set EIA_API_KEY in .env. Free instant registration at eia.gov/opendata/register.php',
      indicators: {},
      fetchedAt: new Date().toISOString(),
    };
  }

  const results = await Promise.allSettled(
    Object.entries(SERIES).map(async ([key, meta]) => {
      const data = await fetchEIASeries(meta.id);
      if (!data || data.length < 2) return { key, error: 'no data' };

      const latest = data[0];
      const prior = data[1];
      const weeklyChange = latest.value - prior.value;

      return {
        key,
        name: meta.name,
        bullishWhen: meta.bullishWhen,
        latestValue: latest.value,
        latestDate: latest.date,
        priorValue: prior.value,
        weeklyChange: Number(weeklyChange.toFixed(2)),
        trend: weeklyChange > 0 ? 'build' : 'draw',
      };
    })
  );

  const indicators = {};
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value.key) {
      indicators[r.value.key] = r.value;
    }
  });

  // Derive energy trade signals
  const crudeChange = indicators.crude_inventory?.weeklyChange ?? 0;
  const natgasChange = indicators.natgas_storage?.weeklyChange ?? 0;

  const signals = [];
  if (crudeChange < -2) signals.push({ direction: 'bullish', asset: 'crude oil', tickers: ENERGY_TICKERS.oil_bullish, reason: `Large crude draw of ${crudeChange} MMbbl` });
  if (crudeChange > 3) signals.push({ direction: 'bearish', asset: 'crude oil', tickers: ENERGY_TICKERS.oil_bullish, reason: `Unexpected crude build of ${crudeChange} MMbbl` });
  if (natgasChange < -50) signals.push({ direction: 'bullish', asset: 'natural gas', tickers: ENERGY_TICKERS.natgas_bull, reason: `Large natgas draw of ${natgasChange} Bcf` });

  return {
    source: 'eia',
    configured: true,
    indicators,
    derivedSignals: signals,
    energyTickers: ENERGY_TICKERS,
    fetchedAt: new Date().toISOString(),
  };
}
