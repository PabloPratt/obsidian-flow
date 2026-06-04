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

// ── Black-Scholes helpers ──────────────────────────────────────────────────────
function normCDF(x) {
  const a=[0.254829592,-0.284496736,1.421413741,-1.453152027,1.061405429],p=0.3275911,sign=x<0?-1:1;
  x=Math.abs(x)/Math.sqrt(2);
  const t=1/(1+p*x),y=1-(((((a[4]*t+a[3])*t+a[2])*t+a[1])*t+a[0])*t*Math.exp(-x*x));
  return 0.5*(1+sign*y);
}
function calcProb(S,K,iv,T,r=0.045) {
  if(T<=0||iv<=0||S<=0) return {prob:0,delta:0};
  const d1=(Math.log(S/K)+(r+0.5*iv*iv)*T)/(iv*Math.sqrt(T));
  const d2=d1-iv*Math.sqrt(T);
  return { prob:+(normCDF(d2)*100).toFixed(1), delta:+(normCDF(d1)*100).toFixed(1) };
}

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
    const { budget = 100 } = req.query;
    const sym = symbol.toUpperCase();

    // Check cache first (5 min TTL)
    const cached = optionsCache.get(sym);
    if (cached && Date.now() - cached.ts < 300000) {
      return res.json(cached.data);
    }

    // Get live price
    let livePrice;
    try {
      const q = await yf.quote(sym);
      livePrice = q.regularMarketPrice;
    } catch { return res.json([]); }

    const today = new Date();
    const maxCost = parseFloat(budget) * 100; // Convert to cents

    // Get all expiration dates
    let expiries = [];
    try {
      const base = await yf.options(symbol.toUpperCase());
      expiries = (base.expirationDates ?? [])
        .map(d => d.toISOString().slice(0,10))
        .filter(d => d > today.toISOString().slice(0,10))
        .slice(0, 8); // First 8 expirations
    } catch { return res.json([]); }

    if (!expiries.length) return res.json([]);

    // Search across ALL expiries for best 60%+ ITM options
    let allOptions = [];
    for (const exp of expiries) {
      try {
        const chain = await yf.options(symbol.toUpperCase(), { date: new Date(exp) });
        const calls = chain.options?.[0]?.calls ?? [];
        const T = Math.max((new Date(exp) - today) / 1000 / 86400 / 365, 0.001);

        calls
          .filter(c => (c.ask ?? 0) > 0.01 && (c.ask ?? 0) * 100 <= maxCost && (c.volume ?? 0) > 0)
          .forEach(c => {
            const { prob } = calcProb(livePrice, c.strike, c.impliedVolatility ?? 0.4, T);
            const isITM = livePrice > c.strike;
            if (prob >= 60) { // Only 60%+ probability
              allOptions.push({
                ticker: symbol.toUpperCase(),
                strike: c.strike,
                expiry: exp,
                ask: c.ask,
                cost: Math.round((c.ask ?? 0) * 100),
                volume: c.volume ?? 0,
                iv: c.impliedVolatility ? +(c.impliedVolatility * 100).toFixed(0) : null,
                prob,
                itm: isITM,
              });
            }
          });
      } catch { }
    }

    // Sort: ITM first (highest prob), then by probability
    allOptions.sort((a,b) => {
      if (a.itm !== b.itm) return b.itm ? 1 : -1;
      return b.prob - a.prob;
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
