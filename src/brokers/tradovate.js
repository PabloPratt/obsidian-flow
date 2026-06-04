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

let _tokens = { 1: null, 2: null };
let _tokenExpiry = { 1: 0, 2: 0 };
let _activeAccount = 1;

function env() {
  return process.env.TRADOVATE_ENV === 'live' ? 'live' : 'demo';
}

export function selectAccount(accountNum) {
  if (![1, 2].includes(accountNum)) throw new Error('Invalid account: use 1 or 2');
  _activeAccount = accountNum;
}

export function getActiveAccount() {
  return _activeAccount;
}

async function authenticate(accountNum = _activeAccount) {
  const usernameKey = `TRADOVATE_ACCOUNT_${accountNum}_USERNAME`;
  const passwordKey = `TRADOVATE_ACCOUNT_${accountNum}_PASSWORD`;
  const username = process.env[usernameKey];
  const password = process.env[passwordKey];
  const appId = process.env.TRADOVATE_APP_ID;
  const appVer = process.env.TRADOVATE_APP_VERSION;

  if (!username) throw new Error(`${usernameKey} not set — sign up free at tradovate.com`);

  const res = await fetch(`${ENDPOINTS[env()]}/auth/accesstokenrequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: username,
      password: password,
      appId: appId ?? 'Sample App',
      appVersion: appVer ?? '1.0',
      cid: 0,
      sec: '',
    }),
  });
  if (!res.ok) throw new Error(`Tradovate auth failed (account ${accountNum}): ${res.status}`);
  const data = await res.json();
  if (data['p-ticket']) throw new Error('Tradovate requires 2FA — complete in app first');
  _tokens[accountNum] = data.accessToken;
  _tokenExpiry[accountNum] = Date.now() + (data.expirationTime ?? 60) * 60 * 1000 - 30000;
  return _tokens[accountNum];
}

async function token(accountNum = _activeAccount) {
  if (!_tokens[accountNum] || Date.now() > _tokenExpiry[accountNum]) await authenticate(accountNum);
  return _tokens[accountNum];
}

async function tvFetch(path, method = 'GET', body = null, accountNum = _activeAccount) {
  const t = await token(accountNum);
  const res = await fetch(`${ENDPOINTS[env()]}${path}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Tradovate error ${res.status}: ${await res.text()}`);
  return res.json();
}

/** List available futures contracts */
export async function getContracts(productName = null, accountNum = _activeAccount) {
  if (!isConfigured()) return [];
  const data = await tvFetch('/contract/items', 'GET', null, accountNum);
  if (!productName) return data;
  return data.filter(c => c.name.includes(productName.toUpperCase()));
}

/** Get current account summary */
export async function getAccount(accountNum = _activeAccount) {
  if (!isConfigured()) return null;
  const accounts = await tvFetch('/account/list', 'GET', null, accountNum);
  return accounts?.[0] ?? null;
}

/** Open positions */
export async function getPositions(accountNum = _activeAccount) {
  if (!isConfigured()) return [];
  return tvFetch('/position/list', 'GET', null, accountNum) ?? [];
}

/** Live quote for a contract */
export async function getQuote(contractId, accountNum = _activeAccount) {
  if (!isConfigured()) return null;
  const t = await token(accountNum);
  const res = await fetch(`${MD_ENDPOINTS[env()]}/md/getQuote?contractId=${contractId}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/** Recent trades / fills */
export async function getFills(accountNum = _activeAccount) {
  if (!isConfigured()) return [];
  return tvFetch('/fill/list', 'GET', null, accountNum) ?? [];
}

export const isConfigured = () => !!process.env.TRADOVATE_ACCOUNT_1_USERNAME;
