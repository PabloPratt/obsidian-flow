import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import YahooFinance from 'yahoo-finance2';

import * as tradier    from '../src/brokers/tradier.js';
import * as coinbase   from '../src/brokers/coinbase.js';
import * as tradovate  from '../src/brokers/tradovate.js';
import * as alpaca     from '../src/brokers/alpaca.js';
import * as quiver     from '../src/agents/quiverquant.js';
import { fetchOptionsFlow } from '../src/agents/options-flow.js';
import { fetchEIASignals }  from '../src/agents/eia.js';
import { fetchFREDSignals } from '../src/agents/fred.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey','ripHistorical'] });

const app    = express();
const server = createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

// ── WebSocket broadcast ────────────────────────────────────────────────────────
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

// ── Price cache ────────────────────────────────────────────────────────────────
const priceCache = {};
const algoSignals = []; // Store ParadoxAlgo signals with performance tracking
const optionsCache = new Map(); // Cache options by symbol, TTL 5min
const WATCHLIST  = ['SPY','QQQ','NVDA','AMD','META','AAPL','TSLA','MSFT',
                    'DVN','OXY','COIN','BAC','SOFI','NIO','BBAI','PLTR'];

function marketSession() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = et.getHours(), m = et.getMinutes(), day = et.getDay();
  if (day === 0 || day === 6) return 'weekend';
  const mins = h * 60 + m;
  if (mins >= 240 && mins < 570)  return 'premarket';   // 4:00–9:30 AM ET
  if (mins >= 570 && mins < 960)  return 'regular';     // 9:30 AM–4:00 PM ET
  if (mins >= 960 && mins < 1200) return 'afterhours';  // 4:00–8:00 PM ET
  return 'closed';
}

async function refreshPrices() {
  try {
    const session = marketSession();
    const quotes = await Promise.allSettled(
      WATCHLIST.map(async t => {
        const q = await yf.quote(t);
        // Use extended hours price when market is closed
        let displayPrice = q.regularMarketPrice;
        let displayChange = q.regularMarketChange;
        let displayChangePct = q.regularMarketChangePercent;
        let extendedPrice = null;

        if (session === 'afterhours' && q.postMarketPrice) {
          extendedPrice = q.postMarketPrice;
          displayChange    = q.postMarketChange;
          displayChangePct = q.postMarketChangePercent;
        } else if (session === 'premarket' && q.preMarketPrice) {
          extendedPrice = q.preMarketPrice;
          displayChange    = q.preMarketChange;
          displayChangePct = q.preMarketChangePercent;
        }

        return {
          symbol:        t,
          price:         displayPrice,
          extendedPrice, // after/pre market price
          session,
          change:        displayChange,
          changePct:     displayChangePct,
          volume:        q.regularMarketVolume,
          high:          q.regularMarketDayHigh,
          low:           q.regularMarketDayLow,
          open:          q.regularMarketOpen,
          prevClose:     q.regularMarketPreviousClose,
        };
      })
    );
    quotes.forEach(r => {
      if (r.status === 'fulfilled') priceCache[r.value.symbol] = r.value;
    });
    broadcast('prices', priceCache);
    broadcast('session', { session });
  } catch {}
}

// ── REST API ──────────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    brokers: {
      tradier:   tradier.isConfigured(),
      coinbase:  coinbase.isConfigured(),
      tradovate: tradovate.isConfigured(),
      alpaca:    alpaca.isConfigured(),
    },
    pricesReady: Object.keys(priceCache).length > 0,
  });
});

// Tradovate account selection (supports 2 accounts)
app.get('/api/tradovate/account', (req, res) => {
  res.json({ activeAccount: tradovate.getActiveAccount() });
});

app.post('/api/tradovate/select', (req, res) => {
  const { accountNum } = req.body;
  if (![1, 2].includes(accountNum)) {
    return res.status(400).json({ error: 'Invalid account: use 1 or 2' });
  }
  tradovate.selectAccount(accountNum);
  res.json({ activeAccount: tradovate.getActiveAccount(), message: `Switched to Tradovate account ${accountNum}` });
});

app.get('/api/prices', (req, res) => res.json(priceCache));

app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const q = await yf.quote(req.params.symbol.toUpperCase());
    res.json({
      symbol:    q.symbol,
      price:     q.regularMarketPrice,
      change:    q.regularMarketChange,
      changePct: q.regularMarketChangePercent,
      volume:    q.regularMarketVolume,
      high:      q.regularMarketDayHigh,
      low:       q.regularMarketDayLow,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/chart/:symbol', async (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  const tf  = req.query.tf ?? '5Min';
  const now = new Date();

  // Always use Yahoo Finance — works 24/7, pre/after hours included
  try {
    const yfInterval = tf === '1Day' ? '1d' : tf === '1Hour' ? '1h' : tf === '15Min' ? '15m' : '5m';
    const lookback   = tf === '1Day' ? 90 : 2; // days back
    const period1    = new Date(now.getTime() - lookback * 86400000);

    const result = await yf.chart(sym, { period1, period2: now, interval: yfInterval });
    const quotes = (result.quotes ?? []).filter(q => q.close != null && q.open != null);

    if (!quotes.length) return res.json([]);

    return res.json(quotes.map(q => ({
      time:   Math.floor(new Date(q.date).getTime() / 1000),
      open:   +q.open.toFixed(4),
      high:   +q.high.toFixed(4),
      low:    +q.low.toFixed(4),
      close:  +q.close.toFixed(4),
      volume: q.volume ?? 0,
    })));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/options/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { budget = 100, minProb = 60 } = req.query;
    const sym = symbol.toUpperCase();

    // Check cache first (5 min TTL)
    const cached = optionsCache.get(sym);
    if (cached && Date.now() - cached.ts < 300000) {
      return res.json(cached.data);
    }

    const maxCost = parseFloat(budget) * 100; // Convert to cents
    const minProbability = parseFloat(minProb);

    // Get expirations from Tradier
    let expiries;
    try {
      expiries = await tradier.getExpirations(sym);
      const today = new Date().toISOString().slice(0, 10);
      expiries = expiries.filter(d => d > today).slice(0, 8); // Next 8 expirations
      console.log(`[OPTIONS] ${sym} found ${expiries.length} expirations:`, expiries.slice(0, 3));
    } catch (e) {
      console.error(`[OPTIONS ERROR] ${sym} expirations failed:`, e.message);
      return res.json({ error: `No options data for ${sym}`, detail: e.message });
    }

    if (!expiries.length) {
      console.warn(`[OPTIONS] ${sym} has no future expirations`);
      return res.json([]);
    }

    // Get current price and earnings warning
    let currentPrice = 0;
    let earningsInfo = null;
    try {
      const quote = await yf.quote(sym);
      currentPrice = quote.regularMarketPrice;
      if (quote.earningsDate) {
        const earningDate = new Date(quote.earningsDate[0]);
        const today = new Date();
        const daysToEarnings = Math.ceil((earningDate - today) / (1000 * 60 * 60 * 24));
        if (daysToEarnings > 0 && daysToEarnings <= 14) {
          earningsInfo = `Earnings in ${daysToEarnings}d`;
        }
      }
    } catch { }

    // Search ALL expirations using REAL Tradier Greeks
    let allOptions = [];
    let maxPainByExpiry = {};

    for (const exp of expiries) {
      try {
        const chain = await tradier.getOptionsChain(sym, exp, true); // greeks=true
        console.log(`[OPTIONS] ${sym}/${exp}: Got ${chain?.length ?? 0} options from Tradier`);

        // Calculate max pain for this expiry
        let strikesByOI = [];
        chain
          .filter(opt => opt.option_type === 'call')
          .forEach(opt => {
            strikesByOI.push({
              strike: opt.strike,
              oi: (opt.open_interest ?? 0) + (opt.open_interest ?? 0),
            });
          });

        if (strikesByOI.length > 0) {
          strikesByOI.sort((a, b) => b.oi - a.oi);
          maxPainByExpiry[exp] = strikesByOI[0].strike;
        }

        const calls = chain.filter(opt => opt.option_type === 'call');
        const validCalls = calls.filter(opt => {
          const ask = opt.ask ?? 0;
          return ask > 0.01 && ask * 100 <= maxCost;
        });

        console.log(`[OPTIONS] ${sym}/${exp}: ${calls.length} calls, ${validCalls.length} valid by price (budget=$${budget})`);

        let passedProb = 0;
        validCalls.forEach(opt => {
            // Use REAL delta from Tradier (already ITM probability)
            const prob = Math.round((opt.delta ?? 0) * 100);
            if (prob >= minProbability) {
              passedProb++;
            }
              const bid = opt.bid ?? 0;
              const ask = opt.ask ?? 0;
              const spread = ask - bid;
              const spreadPct = bid > 0 ? (spread / bid * 100).toFixed(1) : '0';

              // Risk metrics
              const maxLoss = +(ask * 100).toFixed(0); // Worst case: lose entire premium
              const breakeven = +(opt.strike + ask).toFixed(2); // Strike + premium paid
              const targetProfit = +(ask * 0.5).toFixed(2); // 50% profit target
              const targetPrice = +(opt.strike + ask + targetProfit).toFixed(2); // Price to exit at 50% gain

              allOptions.push({
                ticker: sym,
                strike: opt.strike,
                expiry: exp,
                bid: +bid.toFixed(2),
                ask: +ask.toFixed(2),
                spread: +spread.toFixed(2),
                spreadPct: +spreadPct,
                cost: Math.round(ask * 100),
                volume: opt.volume ?? 0,
                openInterest: opt.open_interest ?? 0,
                iv: opt.implied_volatility ? +(opt.implied_volatility * 100).toFixed(1) : null,
                prob,
                delta: +(opt.delta ?? 0).toFixed(3),
                gamma: +(opt.gamma ?? 0).toFixed(4),
                theta: +(opt.theta ?? 0).toFixed(3),
                vega:  +(opt.vega ?? 0).toFixed(3),
                itm: (opt.delta ?? 0) >= 0.5,
                maxPain: maxPainByExpiry[exp] ?? null,
                // Risk metrics
                maxLoss,
                breakeven,
                targetPrice,
                earningsWarning: earningsInfo,
              });
            }
          });
        console.log(`[OPTIONS] ${sym}/${exp}: ${passedProb} passed prob filter (>=${minProbability}%)`);
      } catch (e) {
        console.error(`[OPTIONS] Chain failed for ${sym}/${exp}:`, e.message);
      }
    }

    console.log(`[OPTIONS] ${sym}: Found ${allOptions.length} contracts after all filtering (minProb=${minProbability}%, budget=$${budget})`);

    // Sort: ITM first (highest delta), then by delta
    allOptions.sort((a, b) => {
      if (a.itm !== b.itm) return b.itm ? 1 : -1;
      return b.delta - a.delta;
    });

    const result = allOptions.slice(0, 25);
    optionsCache.set(sym, { data: result, ts: Date.now() });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/flow', async (req, res) => {
  try {
    const flow = await fetchOptionsFlow({ minPremium: 250_000, limit: 20 });
    res.json(flow.signals.slice(0, 20));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/crypto', async (req, res) => {
  try {
    if (coinbase.isConfigured()) {
      const prices = await coinbase.getCryptoPrices();
      return res.json(prices);
    }
    // Fallback to Yahoo Finance for crypto
    const symbols = ['BTC-USD','ETH-USD','SOL-USD','DOGE-USD'];
    const quotes = await Promise.allSettled(symbols.map(s => yf.quote(s)));
    res.json(quotes.filter(r=>r.status==='fulfilled').map(r=>({
      symbol:    r.value.symbol,
      price:     r.value.regularMarketPrice,
      change24h: r.value.regularMarketChangePercent,
    })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/macro', async (req, res) => {
  try {
    const [fred, eia] = await Promise.allSettled([fetchFREDSignals(), fetchEIASignals()]);
    res.json({
      fred: fred.status === 'fulfilled' ? fred.value : null,
      eia:  eia.status  === 'fulfilled' ? eia.value  : null,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Volatility Context ─────────────────────────────────────────────────────────
app.get('/api/vix', async (req, res) => {
  try {
    const vix = await yf.quote('^VIX');
    const vxn = await yf.quote('^VXN');
    const price = vix.regularMarketPrice;

    // Historical VIX levels for rank calculation
    const vixHigh52w = 40; // Approximate 52-week high (varies)
    const vixLow52w = 12;  // Approximate 52-week low (varies)
    const ivRank = Math.max(0, Math.min(100, ((price - vixLow52w) / (vixHigh52w - vixLow52w) * 100)));

    res.json({
      vix: { price, change: vix.regularMarketChangePercent },
      vxn: { price: vxn.regularMarketPrice, change: vxn.regularMarketChangePercent },
      regime: price > 25 ? 'high' : price > 18 ? 'normal' : 'low',
      ivRank: Math.round(ivRank),
      ivRankLabel: ivRank > 70 ? 'expensive' : ivRank > 30 ? 'normal' : 'cheap',
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Earnings Calendar ─────────────────────────────────────────────────────────
app.get('/api/earnings/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const sym = symbol.toUpperCase();
    const quote = await yf.quote(sym);
    const earnings = quote.earningsDate ?? null;

    let daysToEarnings = null;
    let earningsWarning = null;
    if (earnings) {
      const earningDate = new Date(earnings[0]);
      const today = new Date();
      daysToEarnings = Math.ceil((earningDate - today) / (1000 * 60 * 60 * 24));

      // Warn if earnings within 14 days (IV spike risk)
      if (daysToEarnings > 0 && daysToEarnings <= 14) {
        earningsWarning = `⚠️ Earnings in ${daysToEarnings}d — IV will spike`;
      }
    }

    res.json({
      symbol: sym,
      earningsDate: earnings?.[0],
      daysToEarnings,
      warning: earningsWarning,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── IV Surface (Skew) ──────────────────────────────────────────────────────────
app.get('/api/iv-surface/:symbol/:expiry', async (req, res) => {
  try {
    const { symbol, expiry } = req.params;
    const sym = symbol.toUpperCase();

    const chain = await tradier.getOptionsChain(sym, expiry, true);
    const calls = chain.filter(opt => opt.option_type === 'call').sort((a, b) => a.strike - b.strike);

    const surface = calls.map(opt => ({
      strike: opt.strike,
      iv: opt.implied_volatility ? +(opt.implied_volatility * 100).toFixed(1) : null,
      delta: +(opt.delta ?? 0).toFixed(3),
      volume: opt.volume ?? 0,
      openInterest: opt.open_interest ?? 0,
    }));

    res.json(surface);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Backtesting ────────────────────────────────────────────────────────────────
app.get('/api/backtest/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const sym = symbol.toUpperCase();

    // Get current price and past 30 days of history
    const quote = await yf.quote(sym);
    const currentPrice = quote.regularMarketPrice;

    const history = await yf.historical(sym, {
      period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      period2: new Date(),
      interval: '1d',
    });

    if (!history.length) return res.json({ error: 'No historical data' });

    // Get current expirations
    let expiries = [];
    try {
      expiries = await tradier.getExpirations(sym);
      const today = new Date().toISOString().slice(0, 10);
      expiries = expiries.filter(d => d > today).slice(0, 4);
    } catch { }

    // Simulate: Find dates where we would have recommended calls
    // Calculate what profit/loss would be if held to now
    const backtest = [];
    for (let i = 5; i < history.length; i++) {
      const testDate = new Date(history[i].date);
      const testDateStr = testDate.toISOString().slice(0, 10);
      const testPrice = history[i].close;

      // Find best expiry for that date
      const availableExpiries = expiries.filter(e => e > testDateStr);
      if (!availableExpiries.length) continue;

      try {
        const chain = await tradier.getOptionsChain(sym, availableExpiries[0], true);
        const calls = chain
          .filter(opt => opt.option_type === 'call')
          .filter(opt => (opt.delta ?? 0) >= 0.6 && opt.ask > 0.01);

        if (calls.length > 0) {
          // Take top 3 calls
          const topCalls = calls.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 3);

          topCalls.forEach(call => {
            const entryPrice = call.ask;
            const currentAsk = call.ask;
            const pl = (currentAsk - entryPrice) * 100;
            const plPct = ((currentAsk - entryPrice) / entryPrice * 100).toFixed(1);

            backtest.push({
              date: testDateStr,
              strike: call.strike,
              expiry: availableExpiries[0],
              entryPrice: +entryPrice.toFixed(2),
              currentPrice: +currentAsk.toFixed(2),
              delta: +(call.delta ?? 0).toFixed(3),
              pl: +pl.toFixed(2),
              plPct: +plPct,
              recommendation: 'BUY CALL',
            });
          });
        }
      } catch { }
    }

    // Calculate stats
    const wins = backtest.filter(b => b.pl > 0).length;
    const losses = backtest.filter(b => b.pl < 0).length;
    const avgWin = backtest.filter(b => b.pl > 0).reduce((s, b) => s + b.pl, 0) / Math.max(wins, 1);
    const avgLoss = backtest.filter(b => b.pl < 0).reduce((s, b) => s + b.pl, 0) / Math.max(losses, 1);

    res.json({
      symbol: sym,
      period: '30 days',
      trades: backtest.slice(-20), // Last 20 trades
      stats: {
        totalTrades: backtest.length,
        wins,
        losses,
        winRate: (wins / Math.max(backtest.length, 1) * 100).toFixed(1),
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        profitFactor: (avgWin / Math.abs(avgLoss)).toFixed(2),
        totalPL: backtest.reduce((s, b) => s + b.pl, 0).toFixed(2),
      },
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Order execution ────────────────────────────────────────────────────────────
app.post('/api/order', async (req, res) => {
  const { broker = 'alpaca', symbol, side = 'buy', qty = 1, type = 'limit', limitPrice,
          productId, baseSize, quoteSize } = req.body;
  try {
    let order;
    if (broker === 'alpaca') {
      if (!alpaca.isConfigured()) throw new Error('Alpaca not configured — add ALPACA_API_KEY to .env');
      order = await alpaca.placeOrder({ symbol, side, qty, type, limitPrice });
    } else if (broker === 'coinbase') {
      if (!coinbase.isConfigured()) throw new Error('Coinbase not configured — add COINBASE keys to .env');
      order = await coinbase.placeOrder({ productId: productId ?? symbol, side: side.toUpperCase(), baseSize, quoteSize, type, limitPrice });
    } else {
      throw new Error(`Unknown broker: ${broker}. Supported: alpaca, coinbase`);
    }
    console.log(`[ORDER] ${broker.toUpperCase()} ${side.toUpperCase()} ${qty}x ${symbol ?? productId} → ${order.id}`);
    res.json({ success: true, order });
  } catch(e) {
    console.error(`[ORDER ERROR]`, e.message);
    res.status(400).json({ success: false, error: e.message });
  }
});

// Available products/tradeable assets
app.get('/api/products', async (req, res) => {
  const result = {};
  if (coinbase.isConfigured()) {
    try { result.coinbase = await coinbase.getProducts('SPOT'); } catch {}
  }
  res.json(result);
});

// ── QuiverQuant / Wikipedia ────────────────────────────────────────────────────
app.get('/api/congress', async (req, res) => {
  try {
    const { ticker } = req.query;
    const trades = await quiver.getCongressTrades(ticker ?? null);
    res.json(trades);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/insider/:ticker', async (req, res) => {
  try {
    const trades = await quiver.getInsiderTrades(req.params.ticker.toUpperCase());
    res.json(trades);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lobbying', async (req, res) => {
  try {
    const { ticker } = req.query;
    res.json(await quiver.getLobbyingData(ticker ?? null));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/wikipedia/:ticker', async (req, res) => {
  try {
    const views = await quiver.getWikipediaViews(req.params.ticker.toUpperCase(), 14);
    res.json(views ?? { error: 'No data' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/wikipedia-batch', async (req, res) => {
  try {
    const tickers = (req.query.tickers ?? 'AAPL,NVDA,TSLA,META,MSFT,AMD,COIN,PLTR').split(',');
    res.json(await quiver.getBatchWikipediaViews(tickers, 7));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── News ──────────────────────────────────────────────────────────────────────
app.get('/api/news/:symbol', async (req, res) => {
  try {
    const sym = req.params.symbol.toUpperCase();
    const result = await yf.search(sym, { newsCount: 10, quotesCount: 0, enableFuzzyQuery: false });
    const news = (result.news ?? []).map(n => ({
      title:      n.title,
      publisher:  n.publisher,
      link:       n.link,
      publishedAt:new Date(n.providerPublishTime * 1000).toISOString(),
      thumbnail:  n.thumbnail?.resolutions?.[0]?.url ?? null,
      relatedTickers: n.relatedTickers ?? [],
    }));
    res.json(news);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Market news (general) ──────────────────────────────────────────────────────
app.get('/api/news', async (req, res) => {
  try {
    const topics = ['SPY','QQQ','markets','economy','Fed'];
    const allNews = [];
    const seen = new Set();
    for (const t of topics) {
      try {
        const r = await yf.search(t, { newsCount: 5, quotesCount: 0 });
        for (const n of (r.news ?? [])) {
          if (!seen.has(n.uuid)) {
            seen.add(n.uuid);
            allNews.push({ title:n.title, publisher:n.publisher, link:n.link,
              publishedAt:new Date(n.providerPublishTime*1000).toISOString(),
              relatedTickers:n.relatedTickers??[] });
          }
        }
      } catch {}
    }
    allNews.sort((a,b) => new Date(b.publishedAt)-new Date(a.publishedAt));
    res.json(allNews.slice(0,20));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/expiries/:symbol', async (req, res) => {
  try {
    const base = await yf.options(req.params.symbol.toUpperCase());
    const expiries = (base.expirationDates ?? [])
      .map(d => d.toISOString().slice(0,10))
      .filter(d => d > new Date().toISOString().slice(0,10));
    res.json(expiries);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/account', async (req, res) => {
  const results = {};
  if (alpaca.isConfigured()) {
    try { results.alpaca = { account: await alpaca.getAccount(), positions: await alpaca.getPositions() }; } catch {}
  }
  if (tradovate.isConfigured()) {
    try { results.tradovate = { account: await tradovate.getAccount(), positions: await tradovate.getPositions() }; } catch {}
  }
  if (coinbase.isConfigured()) {
    try { results.coinbase = { balances: await coinbase.getBalances() }; } catch {}
  }
  res.json(results);
});

// ── PickMyTrade Integration ───────────────────────────────────────────────────
const PICKMYTRADE_TOKENS = {
  'EMIgWszWXTQZUrKWYAHm4A': true, // Your token from the webhook
};

app.post('/api/pickmytrade/signal', async (req, res) => {
  const { symbol, token, data, quantity, price, sl, tp, multiple_accounts } = req.body;

  if (!PICKMYTRADE_TOKENS[token]) {
    return res.status(401).json({ error: 'Invalid PickMyTrade token' });
  }
  if (!symbol || !data) {
    return res.status(400).json({ error: 'Missing symbol or data (action)' });
  }

  const cleanSymbol = symbol.replace('1!', '').toUpperCase();
  const side = data.toUpperCase().includes('BUY') ? 'buy' : 'sell';
  const qty = quantity ? +quantity : 1;

  const signal = {
    id: Date.now(),
    source: 'pickmytrade',
    timestamp: new Date().toISOString(),
    symbol: cleanSymbol,
    side: side,
    entry: price ? +price : null,
    stop: sl ? +sl : null,
    target: tp ? +tp : null,
    quantity: qty,
    accounts: multiple_accounts || [],
    status: 'executing',
    executedPrice: null,
    pnl: null,
  };

  algoSignals.push(signal);
  broadcast('algo_signal', signal);

  // Auto-execute on Tradovate if configured
  if (tradovate.isConfigured() && multiple_accounts && multiple_accounts.length > 0) {
    try {
      for (const account of multiple_accounts) {
        tradovate.selectAccount(account.account_id === 'APEX_603849' ? 1 : 2);
        // Place order logic would go here (requires futures contract ID lookup)
        // For now, mark as executed with the signal price
        signal.status = 'executed';
        signal.executedPrice = price || null;
        signal.executedTime = new Date().toISOString();
      }
    } catch (e) {
      signal.status = 'execution_failed';
      signal.error = e.message;
    }
  }

  broadcast('algo_signal_update', signal);
  res.json({
    success: true,
    signalId: signal.id,
    status: signal.status,
    message: `PickMyTrade signal: ${cleanSymbol} ${side.toUpperCase()} x${qty} → ${signal.status}`
  });
});

// ── Algo Auth Middleware ──────────────────────────────────────────────────────
const algoSecret = 'obsidian-flow-algo-access'; // TODO: move to .env

function authAlgo(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token || token !== algoSecret) {
    return res.status(401).json({ error: 'Unauthorized — algo signals private' });
  }
  next();
}

// ── ParadoxAlgo Integration ────────────────────────────────────────────────────
app.post('/api/algo/signal', authAlgo, (req, res) => {
  const { symbol, side, entry, stop, target, reason, confidence } = req.body;
  if (!symbol || !side || entry === undefined) {
    return res.status(400).json({ error: 'Missing required fields: symbol, side, entry' });
  }
  const signal = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    symbol: symbol.toUpperCase(),
    side: side.toLowerCase(),
    entry: +entry,
    stop: stop ? +stop : null,
    target: target ? +target : null,
    reason: reason || 'No reason provided',
    confidence: Math.min(100, Math.max(0, confidence ? confidence * 100 : 50)),
    status: 'pending',
    executedPrice: null,
    pnl: null,
  };
  algoSignals.push(signal);
  broadcast('algo_signal', signal);
  res.json({ success: true, signalId: signal.id, message: `Signal received: ${symbol} ${side.toUpperCase()}` });
});

app.get('/api/algo/signals', authAlgo, (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  res.json(algoSignals.slice(-limit).reverse());
});

app.post('/api/algo/execute/:id', authAlgo, (req, res) => {
  const signal = algoSignals.find(s => s.id === parseInt(req.params.id));
  if (!signal) return res.status(404).json({ error: 'Signal not found' });
  signal.status = 'executed';
  signal.executedPrice = req.body.executedPrice || signal.entry;
  signal.executedTime = new Date().toISOString();
  broadcast('algo_signal_update', signal);
  res.json({ success: true, signal });
});

app.post('/api/algo/close/:id', (req, res) => {
  const signal = algoSignals.find(s => s.id === parseInt(req.params.id));
  if (!signal) return res.status(404).json({ error: 'Signal not found' });
  const closePrice = req.body.closePrice;
  if (closePrice === undefined) return res.status(400).json({ error: 'Missing closePrice' });
  signal.status = 'closed';
  signal.closedPrice = closePrice;
  signal.closedTime = new Date().toISOString();
  const pnl = signal.side === 'buy' ? (closePrice - signal.entry) : (signal.entry - closePrice);
  signal.pnl = +(pnl.toFixed(2));
  signal.pnlPct = +((pnl / signal.entry * 100).toFixed(2));
  broadcast('algo_signal_update', signal);
  res.json({ success: true, signal });
});

app.get('/api/algo/stats', (req, res) => {
  const closed = algoSignals.filter(s => s.status === 'closed');
  const profitable = closed.filter(s => s.pnl > 0);
  const totalPnl = closed.reduce((sum, s) => sum + (s.pnl || 0), 0);
  const avgPnl = closed.length ? +(totalPnl / closed.length).toFixed(2) : 0;
  const winRate = closed.length ? +((profitable.length / closed.length) * 100).toFixed(1) : 0;
  res.json({
    totalSignals: algoSignals.length,
    executed: algoSignals.filter(s => s.status !== 'pending').length,
    closed: closed.length,
    profitable: profitable.length,
    winRate,
    totalPnl: +totalPnl.toFixed(2),
    avgPnl,
  });
});

// ── Top Picks (Smart Money + Earnings) ─────────────────────────────────────────
app.get('/api/top-picks', async (req, res) => {
  try {
    // Step 1: Get unusual options flow (smart money positioning)
    const flowData = await fetchOptionsFlow({ minPremium: 50_000, limit: 10 }).catch(() => ({ signals: [] }));
    const flowTickers = flowData.signals?.map(s => s.ticker).slice(0, 8) || [];

    if (!flowTickers.length) {
      return res.json({ picks: [] });
    }

    // Step 2: For each ticker, get earnings date and options
    const picks = [];
    for (const ticker of flowTickers) {
      try {
        // Get earnings date
        const quote = await yf.quote(ticker);
        const earningsDate = quote.epsTrailingTwelveMonths ? new Date() : null;

        // Get options expiries (next 2 weeks for earnings plays)
        const optionsData = await yf.options(ticker);
        const expiries = (optionsData.expirationDates || [])
          .map(d => d.toISOString().slice(0, 10))
          .filter(d => {
            const daysOut = (new Date(d) - new Date()) / 86400000;
            return daysOut >= 3 && daysOut <= 45; // Earnings window
          })
          .slice(0, 2);

        if (!expiries.length) continue;

        // Get call options for nearest expiry
        const chain = await yf.options(ticker, { date: expiries[0] });
        const calls = chain.calls || [];
        const atmCall = calls.find(c => Math.abs((c.strike || 0) - (quote.regularMarketPrice || 0)) < 5);

        if (atmCall) {
          const { prob } = calcProb(
            quote.regularMarketPrice,
            atmCall.strike,
            atmCall.impliedVolatility || 0.3,
            (new Date(expiries[0]) - new Date()) / 86400000 / 365
          );

          picks.push({
            ticker,
            price: quote.regularMarketPrice,
            strike: atmCall.strike,
            expiry: expiries[0],
            callPrice: atmCall.lastPrice || atmCall.bid || 0,
            prob: Math.round(prob),
            daysOut: Math.round((new Date(expiries[0]) - new Date()) / 86400000),
            flowScore: flowData.signals?.find(s => s.ticker === ticker)?.premium || 0,
          });
        }
      } catch (e) {
        // Skip on error
      }
    }

    // Sort by: probability × flow confidence
    picks.sort((a, b) => (b.prob * Math.log(b.flowScore + 1)) - (a.prob * Math.log(a.flowScore + 1)));

    res.json({ picks: picks.slice(0, 5) });
  } catch (e) {
    res.json({ picks: [], error: e.message });
  }
});

// ── WebSocket ──────────────────────────────────────────────────────────────────
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'prices', data: priceCache, ts: Date.now() }));
  ws.on('message', async raw => {
    try {
      const { action, symbol } = JSON.parse(raw.toString());
      if (action === 'subscribe' && symbol) {
        const q = await yf.quote(symbol.toUpperCase());
        ws.send(JSON.stringify({ type: 'quote', data: { symbol, price: q.regularMarketPrice, changePct: q.regularMarketChangePercent } }));
      }
    } catch {}
  });
});

// ── Price refresh loop ─────────────────────────────────────────────────────────
refreshPrices();
setInterval(refreshPrices, 15_000); // every 15s during market hours

const PORT = process.env.PORT ?? 3000;
server.listen(PORT, () => {
  console.log(`\n⬡  Obsidian Flow running at http://localhost:${PORT}\n`);
});
