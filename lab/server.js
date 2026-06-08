const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;

loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));

const shared = require("./api/_shared");

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

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

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sse(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": "obsidian-flow-personal-terminal/0.1",
      accept: "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

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

async function marketSnapshot() {
  const fallback = [
    { symbol: "SPY", price: 629.14, change: 0.42, source: "demo" },
    { symbol: "QQQ", price: 554.83, change: 0.68, source: "demo" },
    { symbol: "IWM", price: 218.36, change: -0.21, source: "demo" },
    { symbol: "VIX", price: 14.22, change: -0.74, source: "demo" },
  ];

  const settled = await Promise.allSettled([getYahooQuotes(["SPY", "QQQ", "IWM", "^VIX"])]);

  const yahoo = settled[0].status === "fulfilled" ? settled[0].value : [];
  const live = yahoo.filter((item) => Number.isFinite(item.price));

  return {
    live: live.length > 0,
    items: live.length > 0 ? live : fallback,
    providers: {
      ...shared.providerStatus(),
      yahoo: settled[0].status === "fulfilled" ? "connected" : "unavailable",
    },
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

async function optionsScan(url) {
  const tickers = (url.searchParams.get("tickers") || "SPY,QQQ,NVDA,AMD,AAPL,TSLA")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 12);

  return shared.optionsScan(tickers);
}

function normalizeMassiveSymbol(symbol) {
  const clean = String(symbol || "").trim().replace(/^O:/i, "");
  return clean.startsWith("O:") ? clean : `O:${clean}`;
}

function parseMassiveFeed(url) {
  const feed = String(url.searchParams.get("feed") || "Q").trim().toUpperCase();
  const symbol = normalizeMassiveSymbol(url.searchParams.get("symbol") || "SPY251219C00650000");
  const mode = String(url.searchParams.get("mode") || "delayed").trim().toLowerCase();
  return {
    feed: ["Q", "T", "A", "AM", "FMV"].includes(feed) ? feed : "Q",
    symbol,
    mode: mode === "realtime" ? "realtime" : "delayed",
  };
}

function massiveOptionsWsUrl(mode) {
  if (mode === "realtime") return process.env.MASSIVE_OPTIONS_WS_REALTIME || "wss://socket.massive.com/options";
  return process.env.MASSIVE_OPTIONS_WS_DELAYED || "wss://delayed.massive.com/options";
}

function streamMassiveOptions(req, res, url) {
  const { feed, symbol, mode } = parseMassiveFeed(url);
  const apiKey = process.env.MASSIVE_API_KEY;
  const wsUrl = massiveOptionsWsUrl(mode);

  if (!apiKey) {
    json(res, 400, { error: "Missing MASSIVE_API_KEY in .env" });
    return;
  }

  if (typeof WebSocket === "undefined") {
    json(res, 500, { error: "WebSocket is not available in this Node runtime" });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write("\n");
  sse(res, "ready", { feed, symbol, mode, wsUrl });

  const socket = new WebSocket(wsUrl);
  let subscribed = false;
  let keepAlive = null;

  const cleanup = () => {
    if (keepAlive) clearInterval(keepAlive);
    try {
      socket.close();
    } catch {
      // ignore
    }
  };

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ action: "auth", params: apiKey }));
    socket.send(JSON.stringify({ action: "subscribe", params: `${feed}.${symbol}` }));
    subscribed = true;
    sse(res, "status", { status: "connected", feed, symbol, mode });
    keepAlive = setInterval(() => {
      sse(res, "ping", { ts: Date.now() });
    }, 25000);
  });

  socket.addEventListener("message", (event) => {
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      sse(res, "message", data);
    } catch (error) {
      sse(res, "raw", { text: String(event.data), error: error.message });
    }
  });

  socket.addEventListener("error", (event) => {
    sse(res, "error", { message: "Massive websocket error", detail: String(event?.message || "unknown") });
  });

  socket.addEventListener("close", () => {
    sse(res, "status", { status: "closed", subscribed, feed, symbol, mode });
    res.end();
    cleanup();
  });

  req.on("close", () => {
    cleanup();
    try {
      res.end();
    } catch {
      // ignore
    }
  });
}

async function routeApi(req, res, url) {
  try {
    if (url.pathname === "/api/market/snapshot") {
      json(res, 200, await marketSnapshot());
      return;
    }

    if (url.pathname === "/api/options/scan") {
      json(res, 200, await optionsScan(url));
      return;
    }

    if (url.pathname === "/api/options/stream") {
      streamMassiveOptions(req, res, url);
      return;
    }

    if (url.pathname === "/api/providers/status") {
      json(res, 200, shared.providerStatus());
      return;
    }

    json(res, 404, { error: "Unknown API route" });
  } catch (error) {
    json(res, 502, { error: error.message });
  }
}

function serveStatic(res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    routeApi(req, res, url);
    return;
  }

  serveStatic(res, url);
});

server.listen(port, host, () => {
  console.log(`Obsidian Flow running at http://${host}:${port}`);
});
