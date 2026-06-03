/**
 * QuiverQuant — alternative data with market-moving signals:
 *   - Congressional trades (senators/reps buying before legislation)
 *   - Lobbying filings (companies spending to influence policy)
 *   - Wikipedia page views (retail interest leading indicator)
 *   - Insider trades, government contracts, patent filings
 *
 * Free tier: quiverquant.com/dashboard → API tab → copy token
 * Add to .env: QUIVERQUANT_TOKEN=your_token
 *
 * No key needed fallback: Wikipedia page views via Wikimedia API (always free)
 */

import 'dotenv/config';

const BASE = 'https://api.quiverquant.com/beta';

function qqHeaders() {
  const token = process.env.QUIVERQUANT_TOKEN;
  if (!token) throw new Error('QUIVERQUANT_TOKEN not set — free at quiverquant.com/dashboard');
  return { Authorization: `Token ${token}`, Accept: 'application/json' };
}

async function qqFetch(path) {
  const res = await fetch(`${BASE}${path}`, { headers: qqHeaders() });
  if (!res.ok) throw new Error(`QuiverQuant error ${res.status}: ${path}`);
  return res.json();
}

/** Congressional stock trades — senators/reps buying/selling before policy moves */
export async function getCongressTrades(ticker = null) {
  const path = ticker ? `/live/congresstrading/${ticker}` : '/live/congresstrading';
  const data = await qqFetch(path);
  return (Array.isArray(data) ? data : []).slice(0, 20).map(t => ({
    ticker:      t.Ticker,
    politician:  t.Representative,
    party:       t.Party,
    chamber:     t.Chamber,
    transaction: t.Transaction,
    amount:      t.Range,
    reportDate:  t.ReportDate,
    tradeDate:   t.TransactionDate,
    description: t.Description,
    signal:      t.Transaction?.toLowerCase().includes('purchase') ? 'bullish' : 'bearish',
  }));
}

/** Lobbying filings — companies spending to influence regulations */
export async function getLobbyingData(ticker = null) {
  const path = ticker ? `/live/lobbying/${ticker}` : '/live/lobbying';
  const data = await qqFetch(path);
  return (Array.isArray(data) ? data : []).slice(0, 15).map(l => ({
    ticker:   l.Ticker,
    company:  l.Client,
    amount:   l.Amount,
    issue:    l.SpecificIssue,
    quarter:  l.ReportingPeriod,
  }));
}

/** Government contracts — who's getting DoD/federal money */
export async function getGovContracts(ticker = null) {
  const path = ticker ? `/live/govcontractscurrent/${ticker}` : '/live/govcontractscurrent';
  const data = await qqFetch(path);
  return (Array.isArray(data) ? data : []).slice(0, 15).map(c => ({
    ticker:   c.Ticker,
    amount:   c.Amount,
    agency:   c.Agency,
    date:     c.Date,
    description: c.Description,
  }));
}

/** Insider trading filings (Form 4) with enriched data */
export async function getInsiderTrades(ticker) {
  const data = await qqFetch(`/live/insiders/${ticker}`);
  return (Array.isArray(data) ? data : []).slice(0, 10).map(i => ({
    ticker,
    name:        i.Name,
    title:       i.Title,
    transaction: i.Transaction,
    shares:      i.Shares,
    price:       i.Price,
    value:       i.Value,
    date:        i.Date,
    signal:      i.Transaction?.toLowerCase().includes('buy') ? 'bullish' : 'bearish',
  }));
}

/** Patent activity — companies filing patents signal R&D investment */
export async function getPatentActivity(ticker) {
  const data = await qqFetch(`/live/patents/${ticker}`);
  return (Array.isArray(data) ? data : []).slice(0, 10).map(p => ({
    ticker,
    date:     p.Date,
    patents:  p.Patents,
    category: p.Category,
  }));
}

// ── Wikipedia (free, no key needed) ──────────────────────────────────────────
const TICKER_WIKI_MAP = {
  AAPL:'Apple_Inc.', MSFT:'Microsoft', GOOGL:'Alphabet_Inc.', AMZN:'Amazon_(company)',
  TSLA:'Tesla,_Inc.', META:'Meta_Platforms', NVDA:'Nvidia', AMD:'Advanced_Micro_Devices',
  NFLX:'Netflix', INTC:'Intel', IBM:'IBM', COIN:'Coinbase', PLTR:'Palantir_Technologies',
  GME:'GameStop', AMC:'AMC_Entertainment', SPY:'SPDR_S%26P_500_ETF_Trust',
};

export async function getWikipediaViews(ticker, days = 7) {
  const article = TICKER_WIKI_MAP[ticker] ?? ticker;
  const end   = new Date();
  const start = new Date(Date.now() - days * 86_400_000);
  const fmt   = d => d.toISOString().slice(0,10).replace(/-/g,'');

  try {
    const res = await fetch(
      `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${article}/daily/${fmt(start)}/${fmt(end)}`,
      { headers: { 'User-Agent': 'obsidian-flow/1.0 (contact@obsidianflow.app)' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.items ?? [];
    const total = items.reduce((s, d) => s + d.views, 0);
    const avg   = Math.round(total / (items.length || 1));
    const latest = items.at(-1)?.views ?? 0;
    const trend  = items.length >= 2
      ? ((items.at(-1).views - items[0].views) / (items[0].views || 1) * 100).toFixed(0)
      : 0;

    return { ticker, article, total, avg, latest, trend: +trend, days: items.length };
  } catch { return null; }
}

/** Batch Wikipedia views for multiple tickers — public interest signal */
export async function getBatchWikipediaViews(tickers, days = 7) {
  const results = await Promise.allSettled(
    tickers.map(t => getWikipediaViews(t, days))
  );
  return results
    .map(r => r.status === 'fulfilled' ? r.value : null)
    .filter(Boolean)
    .sort((a, b) => b.trend - a.trend); // highest trending first
}

export const isConfigured = () => !!process.env.QUIVERQUANT_TOKEN;
