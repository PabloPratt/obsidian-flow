/**
 * Tradovate API — futures trading (ES, NQ, CL, GC, etc.)
 *
 * Setup (free demo account):
 *   1. Go to tradovate.com → Open Demo Account (instant, no deposit)
 *   2. Log in → Account menu → API Access → Create credentials
 *   3. Add to .env:
 *      TRADOVATE_USERNAME=your@email.com
 *      TRADOVATE_PASSWORD=yourpassword
 *      TRADOVATE_APP_ID=Sample App        (use "Sample App" for demo)
 *      TRADOVATE_APP_VERSION=1.0
 *      TRADOVATE_ENV=demo                 (or "live")
 */

import 'dotenv/config';

const ENDPOINTS = {
  demo: 'https://demo.tradovateapi.com/v1',
  live: 'https://live.tradovateapi.com/v1',
};

const MD_ENDPOINTS = {
  demo: 'https://md.tradovateapi.com/v1',
  live: 'https://md.tradovateapi.com/v1',
};

let _token = null;
let _tokenExpiry = 0;

function env() {
  return process.env.TRADOVATE_ENV === 'live' ? 'live' : 'demo';
}

async function authenticate() {
  const { TRADOVATE_USERNAME, TRADOVATE_PASSWORD, TRADOVATE_APP_ID, TRADOVATE_APP_VERSION } = process.env;
  if (!TRADOVATE_USERNAME) throw new Error('TRADOVATE_USERNAME not set — sign up free at tradovate.com');

  const res = await fetch(`${ENDPOINTS[env()]}/auth/accesstokenrequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: TRADOVATE_USERNAME,
      password: TRADOVATE_PASSWORD,
      appId: TRADOVATE_APP_ID ?? 'Sample App',
      appVersion: TRADOVATE_APP_VERSION ?? '1.0',
      cid: 0,
      sec: '',
    }),
  });
  if (!res.ok) throw new Error(`Tradovate auth failed: ${res.status}`);
  const data = await res.json();
  if (data['p-ticket']) throw new Error('Tradovate requires 2FA — complete in app first');
  _token = data.accessToken;
  _tokenExpiry = Date.now() + (data.expirationTime ?? 60) * 60 * 1000 - 30000;
  return _token;
}

async function token() {
  if (!_token || Date.now() > _tokenExpiry) await authenticate();
  return _token;
}

async function tvFetch(path, method = 'GET', body = null) {
  const t = await token();
  const res = await fetch(`${ENDPOINTS[env()]}${path}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Tradovate error ${res.status}: ${await res.text()}`);
  return res.json();
}

/** List available futures contracts */
export async function getContracts(productName = null) {
  if (!isConfigured()) return [];
  const data = await tvFetch('/contract/items');
  if (!productName) return data;
  return data.filter(c => c.name.includes(productName.toUpperCase()));
}

/** Get current account summary */
export async function getAccount() {
  if (!isConfigured()) return null;
  const accounts = await tvFetch('/account/list');
  return accounts?.[0] ?? null;
}

/** Open positions */
export async function getPositions() {
  if (!isConfigured()) return [];
  return tvFetch('/position/list') ?? [];
}

/** Live quote for a contract */
export async function getQuote(contractId) {
  if (!isConfigured()) return null;
  const t = await token();
  const res = await fetch(`${MD_ENDPOINTS[env()]}/md/getQuote?contractId=${contractId}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/** Recent trades / fills */
export async function getFills() {
  if (!isConfigured()) return [];
  return tvFetch('/fill/list') ?? [];
}

export const isConfigured = () => !!process.env.TRADOVATE_USERNAME;
