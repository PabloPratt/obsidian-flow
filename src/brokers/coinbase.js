/**
 * Coinbase Advanced Trade API — crypto + US stocks (via Coinbase One)
 *
 * Setup (free):
 *   1. Go to coinbase.com → Settings → API → New API Key
 *   2. Select permissions: View (read-only) + Trade (if you want execution)
 *   3. Copy API Key Name + Private Key → add to .env:
 *      COINBASE_API_KEY_NAME=organizations/xxx/apiKeys/xxx
 *      COINBASE_API_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----"
 *   4. For stocks: requires Coinbase One subscription
 */

import 'dotenv/config';
import { createSign } from 'crypto';

const BASE = 'https://api.coinbase.com/api/v3/brokerage';

function buildJWT(method, path) {
  const keyName    = process.env.COINBASE_API_KEY_NAME;
  const privateKey = process.env.COINBASE_API_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!keyName || !privateKey) throw new Error('COINBASE_API_KEY_NAME / COINBASE_API_PRIVATE_KEY not set');

  const now = Math.floor(Date.now() / 1000);
  const uri = `${method} api.coinbase.com${path}`;

  const header  = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyName, nonce: String(now) })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: keyName, iss: 'cdp', nbf: now, exp: now + 120, uri })).toString('base64url');
  const message = `${header}.${payload}`;

  const sign = createSign('SHA256');
  sign.update(message);
  const sig = sign.sign({ key: privateKey, format: 'pem', dsaEncoding: 'ieee-p1363' }, 'base64url');

  return `${message}.${sig}`;
}

async function cbFetch(path, method = 'GET') {
  const jwt = buildJWT(method, path);
  const res = await fetch(`https://api.coinbase.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Coinbase API error: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Live crypto prices */
export async function getCryptoPrices(productIds = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'DOGE-USD']) {
  if (!isConfigured()) return [];
  const results = await Promise.allSettled(
    productIds.map(id => cbFetch(`/api/v3/brokerage/products/${id}`))
  );
  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => ({
      symbol:     r.value.product_id,
      price:      parseFloat(r.value.price),
      change24h:  parseFloat(r.value.price_percentage_change_24h),
      volume24h:  parseFloat(r.value.volume_24h),
      high24h:    parseFloat(r.value.high_24h),
      low24h:     parseFloat(r.value.low_24h),
    }));
}

/** Account balances */
export async function getBalances() {
  if (!isConfigured()) return [];
  const data = await cbFetch('/api/v3/brokerage/accounts');
  return (data.accounts ?? []).map(a => ({
    currency: a.currency,
    balance:  parseFloat(a.available_balance?.value ?? 0),
    hold:     parseFloat(a.hold?.value ?? 0),
  })).filter(a => a.balance > 0);
}

/** Recent orders */
export async function getOrders(limit = 10) {
  if (!isConfigured()) return [];
  const data = await cbFetch(`/api/v3/brokerage/orders/historical/batch?limit=${limit}`);
  return data.orders ?? [];
}

/** Candle data for charts */
export async function getCandles(productId, granularity = 'FIVE_MINUTE') {
  if (!isConfigured()) return [];
  const end   = Math.floor(Date.now() / 1000);
  const start = end - 3600; // last hour
  const data  = await cbFetch(
    `/api/v3/brokerage/products/${productId}/candles?start=${start}&end=${end}&granularity=${granularity}`
  );
  return (data.candles ?? []).map(c => ({
    time:  parseInt(c.start),
    open:  parseFloat(c.open),
    high:  parseFloat(c.high),
    low:   parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume),
  })).reverse();
}

/**
 * Place a crypto order via Coinbase Advanced Trade.
 * productId: e.g. 'BTC-USD', 'ETH-USD', 'SOL-USD'
 * side: 'BUY' | 'SELL'
 * For market buy: specify quoteSize (USD amount, e.g. '100')
 * For market sell: specify baseSize (coin amount, e.g. '0.001')
 * For limit: specify baseSize + limitPrice
 *
 * Stocks + options via Coinbase require Coinbase One membership.
 * Crypto works with standard Coinbase Advanced Trade.
 */
export async function placeOrder({ productId, side = 'BUY', baseSize, quoteSize, type = 'market', limitPrice }) {
  if (!isConfigured()) throw new Error('Coinbase not configured');

  const orderConfig = type === 'limit'
    ? { limit_limit_gtc: { base_size: String(baseSize), limit_price: String(limitPrice) } }
    : side === 'BUY' && quoteSize
      ? { market_market_ioc: { quote_size: String(quoteSize) } }
      : { market_market_ioc: { base_size: String(baseSize) } };

  const body = {
    client_order_id: `obsidian-${Date.now()}`,
    product_id:      productId.toUpperCase(),
    side:            side.toUpperCase(),
    order_configuration: orderConfig,
  };

  const path = '/api/v3/brokerage/orders';
  const jwt  = buildJWT('POST', path);
  const res  = await fetch(`https://api.coinbase.com${path}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error_response?.message ?? data.error ?? `Coinbase order error: ${res.status}`);
  }
  const o = data.success_response;
  return {
    id:        o.order_id,
    productId: o.product_id,
    side:      o.side,
    type,
    status:    'pending',
    broker:    'coinbase',
  };
}

/** Get all available products (crypto + stocks if Coinbase One) */
export async function getProducts(productType = null) {
  if (!isConfigured()) return [];
  const params = productType ? `?product_type=${productType}` : '';
  const data = await cbFetch(`/api/v3/brokerage/products${params}`);
  return (data.products ?? []).map(p => ({
    id:          p.product_id,
    baseCurrency:p.base_currency_id,
    quoteCurrency:p.quote_currency_id,
    price:       parseFloat(p.price ?? 0),
    type:        p.product_type,
    tradingDisabled: p.trading_disabled,
  }));
}

export const isConfigured = () =>
  !!(process.env.COINBASE_API_KEY_NAME && process.env.COINBASE_API_PRIVATE_KEY);
