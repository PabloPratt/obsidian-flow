const demoCandidates = [
  contract("NVDA", "call", 150, "2026-07-17", 0.72, 0.68, 0.52, 45, 18420, 6210, 92, "Earnings in 24d", 4.8, 148),
  contract("AMD", "call", 175, "2026-07-24", 0.94, 0.87, 0.47, 38, 9210, 3188, 76, "Earnings in 31d", 4.1, 132),
  contract("TSLA", "call", 245, "2026-07-10", 0.72, 0.61, 0.48, 58, 6400, 2510, 64, "Delivery data", 5.6, 116),
  contract("AAPL", "call", 185, "2026-08-21", 0.83, 0.8, 0.44, 28, 12800, 1510, 41, "Analyst revision", 2.9, 104),
  contract("RIVN", "call", 18, "2026-07-17", 0.38, 0.2, 0.3, 66, 120, 64, 29, "Sector sympathy", 3.2, 82),
];

function contract(ticker, type, strike, expiry, ask, bid, delta, ivRank, oi, volume, flow, catalyst, targetMove, expectedPayoff) {
  return {
    ticker,
    type,
    strike,
    expiry,
    ask,
    bid,
    mid: Number(((ask + bid) / 2).toFixed(3)),
    delta,
    ivRank,
    oi,
    volume,
    flow,
    catalyst,
    targetMove,
    expectedPayoff,
    source: "demo",
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": "obsidian-flow-v2/0.1",
      accept: "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function getYahooQuotes(symbols) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
  const data = await fetchJson(url);
  return (data.quoteResponse?.result || []).map((item) => ({
    symbol: item.symbol,
    price: Number(item.regularMarketPrice),
    change: Number(item.regularMarketChangePercent || 0),
    source: "yahoo",
  }));
}

async function getCoinbaseTicker(productId = "BTC-USD") {
  const data = await fetchJson(`https://api.coinbase.com/api/v3/brokerage/market/products/${encodeURIComponent(productId)}/ticker`);
  const price = Number(data.price || data.trades?.[0]?.price);
  return {
    symbol: productId.replace("-USD", ""),
    price,
    change: null,
    source: "coinbase",
  };
}

async function yahooOptions(ticker) {
  const data = await fetchJson(`https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`);
  const result = data.optionChain?.result?.[0];
  const quote = result?.quote || {};
  const chain = result?.options?.[0];
  if (!chain) return [];

  const rows = [...(chain.calls || []), ...(chain.puts || [])];
  return rows
    .filter((row) => row.ask && row.bid && row.openInterest)
    .slice(0, 80)
    .map((row) => {
      const ask = Number(row.ask);
      const bid = Number(row.bid);
      const type = row.contractSymbol?.includes("C") ? "call" : "put";
      return {
        ticker,
        type,
        strike: Number(row.strike),
        expiry: new Date(Number(row.expiration) * 1000).toISOString().slice(0, 10),
        ask,
        bid,
        mid: Number(((ask + bid) / 2).toFixed(3)),
        delta: type === "call" ? 0.45 : -0.45,
        ivRank: Math.round(Number(row.impliedVolatility || 0.5) * 100),
        oi: Number(row.openInterest || 0),
        volume: Number(row.volume || 0),
        flow: 0,
        catalyst: quote.earningsTimestamp ? "Earnings date present" : "No catalyst loaded",
        targetMove: 3,
        expectedPayoff: Math.max(40, Math.round(ask * 120)),
        source: "yahoo",
      };
    });
}

function tradierBaseUrl() {
  return process.env.TRADIER_ENV === "live" ? "https://api.tradier.com/v1" : "https://sandbox.tradier.com/v1";
}

function tradierFallbackBaseUrl() {
  return process.env.TRADIER_ENV === "live" ? "https://sandbox.tradier.com/v1" : "https://api.tradier.com/v1";
}

function tradierHeaders() {
  return {
    Authorization: `Bearer ${process.env.TRADIER_TOKEN}`,
    Accept: "application/json",
  };
}

async function tradierJson(path) {
  try {
    return await fetchJson(`${tradierBaseUrl()}${path}`, { headers: tradierHeaders() });
  } catch (error) {
    if (!String(error.message).startsWith("401")) throw error;
    return fetchJson(`${tradierFallbackBaseUrl()}${path}`, { headers: tradierHeaders() });
  }
}

async function tradierExpirations(ticker) {
  if (!process.env.TRADIER_TOKEN) return [];
  const data = await tradierJson(`/markets/options/expirations?symbol=${encodeURIComponent(ticker)}&includeAllRoots=true`);
  const dates = data.expirations?.date || [];
  return Array.isArray(dates) ? dates : [dates].filter(Boolean);
}

function normalizeTradierOption(ticker, row, flow = 0) {
  const ask = Number(row.ask);
  const bid = Number(row.bid);
  const type = String(row.option_type || "").toLowerCase() === "put" ? "put" : "call";
  const delta = Number(row.greeks?.delta ?? (type === "call" ? 0.45 : -0.45));
  const iv = Number(row.greeks?.mid_iv ?? row.greeks?.smv_vol ?? row.implied_volatility ?? 0.45);

  return {
    ticker,
    type,
    strike: Number(row.strike),
    expiry: String(row.expiration_date || "").slice(0, 10),
    ask,
    bid,
    mid: Number(((ask + bid) / 2).toFixed(3)),
    delta,
    ivRank: Math.max(1, Math.min(100, Math.round(iv * 100))),
    oi: Number(row.open_interest || 0),
    volume: Number(row.volume || 0),
    flow: Math.min(70, flow),
    catalyst: flow > 0 ? "Ticker-level Unusual Whales flow active" : "Tradier chain with greeks",
    targetMove: Math.max(1.5, Math.min(8, Math.abs(delta) * 9)),
    expectedPayoff: Math.max(40, Math.round(ask * 120)),
    source: "tradier",
  };
}

async function unusualWhalesFlowByTicker(tickers) {
  const token = process.env.UW_API_KEY || process.env.UNUSUAL_WHALES_API_KEY;
  if (!token) return new Map();

  const params = new URLSearchParams({
    limit: "200",
    min_premium: "100000",
  });
  const data = await fetchJson(`https://api.unusualwhales.com/api/option-trades/flow-alerts?${params.toString()}`, {
    headers: {
      Authorization: token,
      Accept: "application/json, text/plain",
    },
  });

  const wanted = new Set(tickers.map((ticker) => ticker.toUpperCase()));
  const rows = Array.isArray(data.data) ? data.data : [];
  const flow = new Map();

  for (const row of rows) {
    const ticker = String(row.ticker || "").toUpperCase();
    if (!wanted.has(ticker)) continue;

    const premium = Number(row.total_premium || row.total_ask_side_prem || row.premium || 0);
    const current = flow.get(ticker) || { count: 0, premium: 0, sweep: false };
    current.count += 1;
    current.premium += Number.isFinite(premium) ? premium : 0;
    current.sweep = current.sweep || Boolean(row.has_sweep);
    flow.set(ticker, current);
  }

  for (const [ticker, stats] of flow.entries()) {
    const premiumScore = Math.min(55, Math.round(stats.premium / 100000));
    const countScore = Math.min(30, stats.count * 5);
    const sweepScore = stats.sweep ? 15 : 0;
    flow.set(ticker, Math.min(100, premiumScore + countScore + sweepScore));
  }

  return flow;
}

async function tradierOptions(ticker, flowScore = 0) {
  const expirations = await tradierExpirations(ticker);
  const expiry = expirations.find(Boolean);
  if (!expiry) return [];

  const params = new URLSearchParams({
    symbol: ticker,
    expiration: expiry,
    greeks: "true",
  });
  const data = await tradierJson(`/markets/options/chains?${params.toString()}`);

  const rawOptions = data.options?.option || [];
  const rows = Array.isArray(rawOptions) ? rawOptions : [rawOptions].filter(Boolean);

  return rows
    .filter((row) => {
      const ask = Number(row.ask);
      const bid = Number(row.bid);
      const oi = Number(row.open_interest || 0);
      const volume = Number(row.volume || 0);
      const delta = Math.abs(Number(row.greeks?.delta ?? 0));
      return ask > 0 && bid >= 0 && oi >= 25 && volume > 0 && delta >= 0.05 && delta <= 0.85;
    })
    .map((row) => normalizeTradierOption(ticker, row, flowScore))
    .sort((a, b) => {
      const aDeltaFit = Math.abs(Math.abs(a.delta) - 0.35);
      const bDeltaFit = Math.abs(Math.abs(b.delta) - 0.35);
      return aDeltaFit - bDeltaFit || b.volume - a.volume || b.oi - a.oi;
    })
    .slice(0, 80);
}

async function optionsScan(tickers) {
  const normalized = tickers
    .map((item) => String(item).trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 12);
  const diagnostics = [];

  if (process.env.TRADIER_TOKEN) {
    try {
      const flow = await unusualWhalesFlowByTicker(normalized).catch((error) => {
        diagnostics.push(`unusual_whales: ${error.message}`);
        return new Map();
      });
      const settled = await Promise.allSettled(normalized.map((ticker) => tradierOptions(ticker, flow.get(ticker) || 0)));
      const candidates = settled.flatMap((item) => (item.status === "fulfilled" ? item.value : []));
      settled.forEach((item, index) => {
        if (item.status === "rejected") diagnostics.push(`tradier ${normalized[index]}: ${item.reason.message}`);
      });

      if (candidates.length > 0) {
        return {
          live: true,
          source: flow.size > 0 ? "tradier_plus_unusual_whales" : "tradier",
          candidates,
          diagnostics,
          message:
            flow.size > 0
              ? "Using Tradier option chains with Unusual Whales flow context."
              : "Using Tradier option chains. Flow context unavailable or not returned.",
        };
      }
      diagnostics.push("tradier: configured but returned no option candidates");
    } catch (error) {
      diagnostics.push(`tradier: ${error.message}`);
    }
  }

  const settled = await Promise.allSettled(normalized.map(yahooOptions));
  const candidates = settled.flatMap((item) => (item.status === "fulfilled" ? item.value : []));

  return {
    live: candidates.length > 0,
    source: candidates.length > 0 ? "yahoo_unofficial" : "demo",
    candidates: candidates.length > 0 ? candidates : demoCandidates,
    diagnostics,
    message:
      candidates.length > 0
        ? "Using unofficial no-key Yahoo options data. Good for prototyping, not institutional-grade accuracy."
        : "No configured provider returned options. Falling back to demo contracts.",
  };
}

function providerStatus() {
  const massiveKey = process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY;
  const uwKey = process.env.UW_API_KEY || process.env.UNUSUAL_WHALES_API_KEY;

  return {
    yahoo: "no_key_required_unofficial",
    alpaca: process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET ? "configured" : "missing_keys",
    tradier: process.env.TRADIER_TOKEN ? `configured_${process.env.TRADIER_ENV === "live" ? "live" : "sandbox"}` : "missing_key",
    massive: massiveKey ? "configured" : "missing_key",
    polygon: massiveKey ? "configured_alias" : "missing_key",
    unusualWhales: uwKey ? "configured" : "missing_key",
  };
}

module.exports = {
  demoCandidates,
  fetchJson,
  getCoinbaseTicker,
  getYahooQuotes,
  optionsScan,
  providerStatus,
  tradierOptions,
  unusualWhalesFlowByTicker,
  yahooOptions,
};
