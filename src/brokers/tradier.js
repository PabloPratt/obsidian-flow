/**
 * Tradier broker — free developer account gives REAL-TIME options data with greeks.
 * Sign up: tradier.com/products/api → get sandbox token instantly (no approval needed)
 * Production token requires approval (1-2 days).
 *
 * Setup:
 *   1. Go to tradier.com/products/api
 *   2. Click "Get API Access" → Developer (free)
 *   3. Copy your sandbox token → add to .env as TRADIER_TOKEN
 *   4. For live trading: apply for production access
 */

import 'dotenv/config';

const SANDBOX = 'https://sandbox.tradier.com/v1';
const LIVE    = 'https://api.tradier.com/v1';

function base() {
  return process.env.TRADIER_ENV === 'live' ? LIVE : SANDBOX;
}

function headers() {
  const token = process.env.TRADIER_TOKEN;
  if (!token) throw new Error('TRADIER_TOKEN not set in .env — get it free at tradier.com/products/api');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

/** Live quotes for one or more tickers */
export async function getQuotes(symbols) {
  const syms = Array.isArray(symbols) ? symbols.join(',') : symbols;
  const res = await fetch(`${base()}/markets/quotes?symbols=${syms}&greeks=false`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Tradier quotes error: ${res.status}`);
  const data = await res.json();
  const quotes = data.quotes?.quote;
  return Array.isArray(quotes) ? quotes : quotes ? [quotes] : [];
}

/** Options chain with REAL greeks (delta, gamma, theta, vega, IV) */
export async function getOptionsChain(symbol, expiration, greeks = true) {
  const res = await fetch(
    `${base()}/markets/options/chains?symbol=${symbol}&expiration=${expiration}&greeks=${greeks}`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Tradier options chain error: ${res.status}`);
  const data = await res.json();
  const options = data.options?.option ?? [];
  return Array.isArray(options) ? options : [options];
}

/** Available expiration dates for a symbol */
export async function getExpirations(symbol) {
  const res = await fetch(`${base()}/markets/options/expirations?symbol=${symbol}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Tradier expirations error: ${res.status}`);
  const data = await res.json();
  return data.expirations?.date ?? [];
}

/** Intraday price history */
export async function getHistory(symbol, interval = '5min', start = null) {
  const params = new URLSearchParams({ symbol, interval });
  if (start) params.set('start', start);
  const res = await fetch(`${base()}/markets/timesales?${params}`, { headers: headers() });
  if (!res.ok) throw new Error(`Tradier history error: ${res.status}`);
  const data = await res.json();
  return data.series?.data ?? [];
}

/** Account positions (requires live/production token) */
export async function getPositions() {
  if (!process.env.TRADIER_ACCOUNT_ID) return [];
  const res = await fetch(
    `${base()}/accounts/${process.env.TRADIER_ACCOUNT_ID}/positions`,
    { headers: headers() }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const positions = data.positions?.position ?? [];
  return Array.isArray(positions) ? positions : [positions];
}

export const isConfigured = () => !!process.env.TRADIER_TOKEN;
