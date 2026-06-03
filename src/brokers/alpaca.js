/**
 * Alpaca Markets — stocks, options, and crypto
 * Keys already configured in .env (ALPACA_API_KEY / ALPACA_SECRET_KEY)
 */

import 'dotenv/config';

const TRADE_BASE = process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets';
const DATA_BASE  = 'https://data.alpaca.markets';

function headers() {
  return {
    'APCA-API-KEY-ID':     process.env.ALPACA_API_KEY,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
    'Content-Type': 'application/json',
  };
}

/** Live stock quotes */
export async function getQuotes(symbols) {
  const syms = Array.isArray(symbols) ? symbols.join(',') : symbols;
  const res = await fetch(`${DATA_BASE}/v2/stocks/quotes/latest?symbols=${syms}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Alpaca quotes error: ${res.status}`);
  return (await res.json()).quotes ?? {};
}

/** Latest bars (OHLCV) */
export async function getBars(symbols, timeframe = '5Min') {
  const syms = Array.isArray(symbols) ? symbols.join(',') : symbols;
  const res = await fetch(
    `${DATA_BASE}/v2/stocks/bars/latest?symbols=${syms}&timeframe=${timeframe}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Alpaca bars error: ${res.status}`);
  return (await res.json()).bars ?? {};
}

/** Historical bars for charting */
export async function getHistoricalBars(symbol, timeframe = '5Min', limit = 100) {
  const res = await fetch(
    `${DATA_BASE}/v2/stocks/${symbol}/bars?timeframe=${timeframe}&limit=${limit}&sort=asc`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Alpaca historical bars error: ${res.status}`);
  const data = await res.json();
  return (data.bars ?? []).map(b => ({
    time:   Math.floor(new Date(b.t).getTime() / 1000),
    open:   b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
  }));
}

/** Account info */
export async function getAccount() {
  const res = await fetch(`${TRADE_BASE}/v2/account`, { headers: headers() });
  if (!res.ok) throw new Error(`Alpaca account error: ${res.status}`);
  return res.json();
}

/** Current positions */
export async function getPositions() {
  const res = await fetch(`${TRADE_BASE}/v2/positions`, { headers: headers() });
  if (!res.ok) return [];
  return res.json();
}

/** Recent orders */
export async function getOrders(limit = 10) {
  const res = await fetch(`${TRADE_BASE}/v2/orders?limit=${limit}&status=all`, {
    headers: headers(),
  });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Place an order. Works for stocks, options, and crypto.
 * For options: symbol must be the OCC contract symbol (e.g. NIO260605C00006000)
 * type: 'market' | 'limit'  side: 'buy' | 'sell'
 */
export async function placeOrder({ symbol, side = 'buy', qty = 1, type = 'limit', limitPrice, timeInForce = 'day' }) {
  const body = {
    symbol:        symbol.toUpperCase(),
    qty:           String(qty),
    side,
    type,
    time_in_force: timeInForce,
  };
  if (type === 'limit' && limitPrice) body.limit_price = String(limitPrice);

  const res = await fetch(`${TRADE_BASE}/v2/orders`, {
    method:  'POST',
    headers: headers(),
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? `Alpaca order error: ${res.status}`);
  return {
    id:        data.id,
    symbol:    data.symbol,
    side:      data.side,
    qty:       data.qty,
    type:      data.type,
    status:    data.status,
    limitPrice:data.limit_price,
    createdAt: data.created_at,
    broker:    'alpaca',
  };
}

export const isConfigured = () =>
  !!(process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY);
