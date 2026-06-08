let marketSnapshot = [
  { symbol: "SPY", price: 629.14, change: 0.42 },
  { symbol: "QQQ", price: 554.83, change: 0.68 },
  { symbol: "IWM", price: 218.36, change: -0.21 },
  { symbol: "VIX", price: 14.22, change: -0.74 },
];

let candidates = [
  {
    ticker: "NVDA",
    type: "call",
    strike: 150,
    expiry: "2026-07-17",
    ask: 0.72,
    bid: 0.68,
    mid: 0.7,
    delta: 0.52,
    ivRank: 45,
    oi: 18420,
    volume: 6210,
    flow: 92,
    catalyst: "Earnings in 24d",
    targetMove: 4.8,
    expectedPayoff: 148,
  },
  {
    ticker: "AMD",
    type: "call",
    strike: 175,
    expiry: "2026-07-24",
    ask: 0.94,
    bid: 0.87,
    mid: 0.91,
    delta: 0.47,
    ivRank: 38,
    oi: 9210,
    volume: 3188,
    flow: 76,
    catalyst: "Earnings in 31d",
    targetMove: 4.1,
    expectedPayoff: 132,
  },
  {
    ticker: "TSLA",
    type: "call",
    strike: 245,
    expiry: "2026-07-10",
    ask: 0.72,
    bid: 0.61,
    mid: 0.665,
    delta: 0.48,
    ivRank: 58,
    oi: 6400,
    volume: 2510,
    flow: 64,
    catalyst: "Delivery data",
    targetMove: 5.6,
    expectedPayoff: 116,
  },
  {
    ticker: "AAPL",
    type: "call",
    strike: 185,
    expiry: "2026-08-21",
    ask: 0.83,
    bid: 0.8,
    mid: 0.815,
    delta: 0.44,
    ivRank: 28,
    oi: 12800,
    volume: 1510,
    flow: 41,
    catalyst: "Analyst revision",
    targetMove: 2.9,
    expectedPayoff: 104,
  },
  {
    ticker: "RIVN",
    type: "call",
    strike: 18,
    expiry: "2026-07-17",
    ask: 0.38,
    bid: 0.2,
    mid: 0.29,
    delta: 0.3,
    ivRank: 66,
    oi: 120,
    volume: 64,
    flow: 29,
    catalyst: "Sector sympathy",
    targetMove: 3.2,
    expectedPayoff: 82,
  },
];

const spotlight = [];
let stagedOrder = null;
let liveStream = null;
const storageKey = "obsidian-flow-personal-book";
const book = loadBook();

const refs = {
  marketStrip: document.querySelector("#market-strip"),
  providerStatus: document.querySelector("#provider-status"),
  maxCost: document.querySelector("#max-cost"),
  minProb: document.querySelector("#min-prob"),
  minOi: document.querySelector("#min-oi"),
  maxIv: document.querySelector("#max-iv"),
  direction: document.querySelector("#direction"),
  watchlist: document.querySelector("#watchlist"),
  scanButton: document.querySelector("#scan-button"),
  summary: document.querySelector("#scan-summary"),
  list: document.querySelector("#candidate-list"),
  accountForm: document.querySelector("#account-form"),
  accountName: document.querySelector("#account-name"),
  accountProvider: document.querySelector("#account-provider"),
  accountList: document.querySelector("#account-list"),
  exportBook: document.querySelector("#export-book"),
  importBook: document.querySelector("#import-book"),
  positionForm: document.querySelector("#position-form"),
  positionAccount: document.querySelector("#position-account"),
  positionKind: document.querySelector("#position-kind"),
  positionSymbol: document.querySelector("#position-symbol"),
  positionDetail: document.querySelector("#position-detail"),
  positionQty: document.querySelector("#position-qty"),
  positionCost: document.querySelector("#position-cost"),
  positionList: document.querySelector("#position-list"),
  streamForm: document.querySelector("#stream-form"),
  streamSymbol: document.querySelector("#stream-symbol"),
  streamFeed: document.querySelector("#stream-feed"),
  streamMode: document.querySelector("#stream-mode"),
  streamDisconnect: document.querySelector("#stream-disconnect"),
  streamStatus: document.querySelector("#stream-status"),
  streamLast: document.querySelector("#stream-last"),
  spotlight: document.querySelector("#spotlight-list"),
  orderStage: document.querySelector("#order-stage"),
};

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function loadBook() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.accounts?.length) {
      return {
        accounts: saved.accounts,
        positions: saved.positions || [],
        settings: {
          watchlist: saved.settings?.watchlist || "SPY,QQQ,NVDA,AMD,AAPL,TSLA",
        },
      };
    }
  } catch {
    // Ignore corrupted local state and rebuild defaults.
  }

  return {
    accounts: [
      { id: "fidelity-main", name: "Fidelity Main", provider: "Fidelity" },
      { id: "robinhood", name: "Robinhood", provider: "Robinhood" },
    ],
    positions: [],
    settings: {
      watchlist: "SPY,QQQ,NVDA,AMD,AAPL,TSLA",
    },
  };
}

function saveBook() {
  localStorage.setItem(storageKey, JSON.stringify(book));
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}

function cost(contract) {
  return Math.round(contract.ask * 100);
}

function spreadPct(contract) {
  return contract.mid ? ((contract.ask - contract.bid) / contract.mid) * 100 : 99;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreOption(contract) {
  const liquidityScore = clamp((contract.oi / 2500) * 50 + (contract.volume / 1000) * 50, 0, 100);
  const probability = clamp(
    30 +
      Math.abs(contract.delta) * 55 +
      contract.flow * 0.18 +
      liquidityScore * 0.08 -
      Math.max(0, contract.ivRank - 55) * 0.35 -
      Math.max(0, spreadPct(contract) - 15) * 0.7,
    1,
    96
  );
  const ivScore = clamp(100 - contract.ivRank, 0, 100);
  const rrScore = clamp((contract.expectedPayoff / cost(contract)) * 45, 0, 100);
  const flowScore = contract.flow;
  const catalystScore = contract.catalyst ? 90 : 35;
  const composite =
    flowScore * 0.3 +
    probability * 0.2 +
    liquidityScore * 0.15 +
    ivScore * 0.15 +
    rrScore * 0.15 +
    catalystScore * 0.05;
  const ev = probability / 100 * contract.expectedPayoff - (1 - probability / 100) * cost(contract);
  const score10 = clamp(composite / 10, 1, 10);
  const heat = score10 >= 8 ? "HOT" : score10 >= 6.5 ? "WARM" : score10 >= 5 ? "WATCH" : "NOT";
  const badges = [];

  if (contract.flow >= 70) badges.push("FLOW BACKED");
  if (liquidityScore >= 65) badges.push("LIQUID");
  if (contract.ivRank > 70) badges.push("HIGH IV");
  if (contract.catalyst) badges.push("CATALYST");
  if (cost(contract) <= 100) badges.push("UNDER $100");
  if (spreadPct(contract) > 15) badges.push("WIDE SPREAD");

  return {
    probability: Math.round(probability),
    score10,
    scoreLabel: score10.toFixed(1),
    heat,
    ev: Math.round(ev),
    badges,
    liquidityScore,
  };
}

function positionContext(contract) {
  const matches = book.positions.filter((position) => position.symbol.toUpperCase() === contract.ticker.toUpperCase());
  const optionMatches = matches.filter((position) => position.kind === "option");
  const stockMatches = matches.filter((position) => position.kind === "stock");
  const totalCost = matches.reduce((sum, position) => sum + Number(position.qty || 0) * Number(position.cost || 0), 0);

  return {
    matches,
    optionMatches,
    stockMatches,
    totalCost,
    hasExposure: matches.length > 0,
    isConcentrated: matches.length >= 2 || totalCost >= 500,
  };
}

function applyBookContext(metrics, context) {
  const adjusted = {
    ...metrics,
    badges: [...metrics.badges],
    contextNote: "",
    score10: metrics.score10,
  };

  if (context.hasExposure) {
    adjusted.badges.push("YOU OWN");
    adjusted.contextNote = `Your book already has ${context.matches.length} ${context.matches.length === 1 ? "entry" : "entries"} tied to this ticker.`;
  }

  if (context.optionMatches.length) adjusted.badges.push("OPEN PLAY");
  if (context.stockMatches.length) adjusted.badges.push("UNDERLYING");
  if (context.isConcentrated) {
    adjusted.badges.push("CONCENTRATION");
    adjusted.score10 = clamp(adjusted.score10 - 0.2, 1, 10);
  }

  adjusted.scoreLabel = adjusted.score10.toFixed(1);
  adjusted.heat = adjusted.score10 >= 8 ? "HOT" : adjusted.score10 >= 6.5 ? "WARM" : adjusted.score10 >= 5 ? "WATCH" : "NOT";

  return adjusted;
}

function passesFilters(contract, metrics) {
  const selectedDirection = refs.direction.value;

  return (
    cost(contract) <= Number(refs.maxCost.value) &&
    metrics.probability >= Number(refs.minProb.value) &&
    contract.oi >= Number(refs.minOi.value) &&
    contract.ivRank <= Number(refs.maxIv.value) &&
    (selectedDirection === "both" || contract.type === selectedDirection)
  );
}

function renderMarketStrip() {
  refs.marketStrip.replaceChildren(
    ...marketSnapshot.map((item) => {
      const tile = document.createElement("div");
      tile.className = "ticker";
      tile.innerHTML = `
        <span>${item.symbol}</span>
        <strong>${item.price.toFixed(2)}</strong>
        <em class="${item.change >= 0 ? "up" : "down"}">${
          item.change === null || Number.isNaN(item.change) ? item.source || "live" : `${item.change >= 0 ? "+" : ""}${item.change.toFixed(2)}%`
        }</em>
      `;
      return tile;
    })
  );
}

function renderProviderStatus(payload) {
  if (!payload) {
    refs.providerStatus.textContent = "Demo mode. Start the local server for free data attempts.";
    return;
  }

  const providers = payload.providers || {};
  refs.providerStatus.textContent = [
    `Market: ${payload.live ? "free live/near-live" : "demo fallback"}`,
    `Yahoo: ${providers.yahoo || "unknown"}`,
    `Alpaca: ${providers.alpaca || "missing_keys"}`,
    `Tradier: ${providers.tradier || "missing_key"}`,
    `Massive: ${providers.massive || providers.polygon || "missing_key"}`,
    `UW: ${providers.unusualWhales || "missing_key"}`,
  ].join(" | ");
}

function renderStreamStatus(text) {
  refs.streamStatus.textContent = text;
}

function renderStreamLast(payload) {
  if (!payload) {
    refs.streamLast.textContent = "No messages yet.";
    return;
  }

  const parts = [payload.ev || "?", payload.sym || "unknown"];
  if (payload.ev === "Q") parts.push(`bp ${payload.bp ?? "-"}`, `ap ${payload.ap ?? "-"}`, `bs ${payload.bs ?? "-"}`, `as ${payload.as ?? "-"}`);
  if (payload.ev === "T") parts.push(`p ${payload.p ?? "-"}`, `s ${payload.s ?? "-"}`);
  if (payload.ev === "FMV") parts.push(`fmv ${payload.fmv ?? "-"}`);
  refs.streamLast.textContent = parts.join(" | ");
}

function disconnectStream() {
  if (liveStream) {
    liveStream.close();
    liveStream = null;
  }
  renderStreamStatus("Not connected.");
}

function connectStream(event) {
  event.preventDefault();
  disconnectStream();

  const symbol = refs.streamSymbol.value.trim();
  if (!symbol) {
    renderStreamStatus("Enter an option symbol first.");
    return;
  }

  const params = new URLSearchParams({
    symbol,
    feed: refs.streamFeed.value,
    mode: refs.streamMode.value,
  });

  const source = new EventSource(`/api/options/stream?${params.toString()}`);
  liveStream = source;
  renderStreamStatus(`Connecting ${refs.streamMode.value} ${refs.streamFeed.value} for ${symbol}...`);

  source.addEventListener("ready", (event) => {
    const data = JSON.parse(event.data);
    renderStreamStatus(`Ready on ${data.mode} ${data.feed} for ${data.symbol}.`);
  });

  source.addEventListener("status", (event) => {
    const data = JSON.parse(event.data);
    renderStreamStatus(`Stream ${data.status} for ${data.symbol}.`);
  });

  source.addEventListener("message", (event) => {
    try {
      renderStreamLast(JSON.parse(event.data));
    } catch {
      renderStreamLast({ ev: "raw", sym: "unknown", bp: event.data });
    }
  });

  source.addEventListener("error", () => {
    renderStreamStatus("Stream error or disconnected.");
  });
}

async function refreshMarketSnapshot() {
  try {
    const payload = await getJson("/api/market/snapshot");
    marketSnapshot = payload.items;
    renderProviderStatus(payload);
    renderMarketStrip();
  } catch {
    renderProviderStatus(null);
    renderMarketStrip();
  }
}

function renderCandidates(sourceMessage = "") {
  const ranked = candidates
    .map((contract) => {
      const context = positionContext(contract);
      return { contract, context, metrics: applyBookContext(scoreOption(contract), context) };
    })
    .filter(({ contract, metrics }) => passesFilters(contract, metrics))
    .sort((a, b) => b.metrics.score10 - a.metrics.score10 || cost(a.contract) - cost(b.contract));

  refs.summary.textContent = `${ranked.length} contracts cleared${sourceMessage ? ` · ${sourceMessage}` : ""}`;

  if (!ranked.length) {
    refs.list.innerHTML = `<div class="empty">No options cleared your filters. Raise max cost, lower min probability, or loosen IV rank.</div>`;
    return;
  }

  refs.list.replaceChildren(
    ...ranked.map(({ contract, metrics, context }) => {
      const card = document.createElement("article");
      card.className = `option-card ${metrics.heat.toLowerCase()}`;
      card.innerHTML = `
        <div class="card-top">
          <div>
            <p class="contract">${contract.ticker} ${contract.expiry} ${contract.strike}${contract.type === "call" ? "C" : "P"}</p>
            <h3>${metrics.heat} ${metrics.scoreLabel}/10</h3>
          </div>
          <div class="probability">
            <strong>${metrics.probability}%</strong>
            <span>probability</span>
          </div>
        </div>
        <div class="metrics-grid">
          <span><b>$${cost(contract)}</b> debit</span>
          <span><b>${contract.delta.toFixed(2)}</b> delta</span>
          <span><b>${contract.ivRank}%</b> IV rank</span>
          <span><b>${contract.oi.toLocaleString()}</b> OI</span>
          <span><b>${contract.volume.toLocaleString()}</b> volume</span>
          <span><b>${metrics.ev >= 0 ? "+" : ""}$${metrics.ev}</b> EV</span>
        </div>
        <div class="badges">${metrics.badges.map((badge) => `<span>${badge}</span>`).join("")}</div>
        <p class="setup">${contract.catalyst}. Target move ${contract.targetMove.toFixed(1)}%. Spread ${spreadPct(contract).toFixed(1)}%.</p>
        ${context.hasExposure ? `<p class="book-context">${metrics.contextNote} Cost basis tracked: $${Math.round(context.totalCost).toLocaleString()}.</p>` : ""}
        <div class="actions">
          <button type="button" data-action="track">Track</button>
          <button type="button" data-action="stage">Stage paper order</button>
        </div>
      `;
      card.querySelector('[data-action="track"]').addEventListener("click", () => track(contract, metrics));
      card.querySelector('[data-action="stage"]').addEventListener("click", () => stage(contract, metrics));
      return card;
    })
  );
}

function renderAccounts() {
  refs.positionAccount.replaceChildren(
    ...book.accounts.map((account) => {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = `${account.provider}: ${account.name}`;
      return option;
    })
  );

  refs.accountList.replaceChildren(
    ...book.accounts.map((account) => {
      const holdings = book.positions.filter((position) => position.accountId === account.id).length;
      const item = document.createElement("div");
      item.className = "account-item";
      item.innerHTML = `
        <div>
          <strong>${account.name}</strong>
          <span>${account.provider} · ${holdings} holdings</span>
        </div>
        <button type="button" aria-label="Remove ${account.name}">Remove</button>
      `;
      item.querySelector("button").addEventListener("click", () => removeAccount(account.id));
      return item;
    })
  );
}

function renderPositions() {
  if (!book.positions.length) {
    refs.positionList.innerHTML = `<div class="empty">No holdings entered yet.</div>`;
    return;
  }

  refs.positionList.replaceChildren(
    ...book.positions.map((position) => {
      const account = book.accounts.find((item) => item.id === position.accountId);
      const item = document.createElement("div");
      item.className = "position-item";
      item.innerHTML = `
        <div>
          <strong>${position.symbol}</strong>
          <span>${position.kind.toUpperCase()} · ${account?.name || "Unknown"} · qty ${position.qty}</span>
          ${position.detail ? `<em>${position.detail}</em>` : ""}
        </div>
        <div>
          <b>$${Number(position.cost).toFixed(2)}</b>
          <button type="button" aria-label="Remove ${position.symbol}">Remove</button>
        </div>
      `;
      item.querySelector("button").addEventListener("click", () => removePosition(position.id));
      return item;
    })
  );
}

function addAccount(event) {
  event.preventDefault();
  const name = refs.accountName.value.trim();
  if (!name) return;

  book.accounts.push({
    id: makeId("account"),
    name,
    provider: refs.accountProvider.value,
  });
  refs.accountName.value = "";
  saveBook();
  renderAccounts();
}

function removeAccount(accountId) {
  if (book.accounts.length === 1) return;
  const index = book.accounts.findIndex((account) => account.id === accountId);
  if (index === -1) return;
  book.accounts.splice(index, 1);
  book.positions = book.positions.filter((position) => position.accountId !== accountId);
  saveBook();
  renderAccounts();
  renderPositions();
  renderCandidates("book updated");
}

function addPosition(event) {
  event.preventDefault();
  const symbol = refs.positionSymbol.value.trim().toUpperCase();
  const qty = Number(refs.positionQty.value);
  const costValue = Number(refs.positionCost.value);
  if (!symbol || !qty || Number.isNaN(costValue)) return;

  book.positions.unshift({
    id: makeId("position"),
    accountId: refs.positionAccount.value,
    kind: refs.positionKind.value,
    symbol,
    detail: refs.positionDetail.value.trim(),
    qty,
    cost: costValue,
  });

  refs.positionSymbol.value = "";
  refs.positionDetail.value = "";
  refs.positionQty.value = "";
  refs.positionCost.value = "";
  saveBook();
  renderAccounts();
  renderPositions();
  renderCandidates("book updated");
}

function removePosition(positionId) {
  book.positions = book.positions.filter((position) => position.id !== positionId);
  saveBook();
  renderAccounts();
  renderPositions();
  renderCandidates("book updated");
}

function exportBook() {
  const payload = {
    exportedAt: new Date().toISOString(),
    ...book,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `obsidian-flow-book-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importBook(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(String(reader.result));
      if (!Array.isArray(imported.accounts) || !Array.isArray(imported.positions)) return;
      book.accounts = imported.accounts;
      book.positions = imported.positions;
      book.settings = {
        watchlist: imported.settings?.watchlist || refs.watchlist.value || "SPY,QQQ,NVDA,AMD,AAPL,TSLA",
      };
      refs.watchlist.value = book.settings.watchlist;
      saveBook();
      renderAccounts();
      renderPositions();
      renderCandidates("book imported");
    } catch {
      refs.summary.textContent = "Import failed. File must be valid Obsidian Flow JSON.";
    }
  });
  reader.readAsText(file);
  event.target.value = "";
}

function track(contract, metrics) {
  const key = `${contract.ticker}-${contract.expiry}-${contract.strike}-${contract.type}`;
  if (!spotlight.some((item) => item.key === key)) {
    spotlight.unshift({ key, contract, metrics, entry: cost(contract) });
  }
  renderSpotlight();
}

function stage(contract, metrics) {
  stagedOrder = { contract, metrics };
  renderOrderStage();
}

function renderSpotlight() {
  if (!spotlight.length) {
    refs.spotlight.innerHTML = `<div class="empty">No picks tracked.</div>`;
    return;
  }

  refs.spotlight.replaceChildren(
    ...spotlight.map(({ contract, metrics, entry }) => {
      const item = document.createElement("div");
      item.className = "spotlight-item";
      item.innerHTML = `
        <strong>${contract.ticker} ${contract.strike}${contract.type === "call" ? "C" : "P"}</strong>
        <span>${metrics.heat} ${metrics.scoreLabel}/10 · ${metrics.probability}% · entry $${entry}</span>
      `;
      return item;
    })
  );
}

function renderOrderStage() {
  if (!stagedOrder) {
    refs.orderStage.innerHTML = "No contract staged.";
    refs.orderStage.className = "order-stage empty";
    return;
  }

  const { contract, metrics } = stagedOrder;
  refs.orderStage.className = "order-stage";
  refs.orderStage.innerHTML = `
    <p>${contract.ticker} ${contract.expiry} ${contract.strike}${contract.type === "call" ? "C" : "P"}</p>
    <strong>Limit $${contract.ask.toFixed(2)} · ${metrics.heat} ${metrics.scoreLabel}/10</strong>
    <span>Paper order staged. Live execution stays off until broker keys are wired.</span>
  `;
}

function scan() {
  refs.summary.textContent = "Scanning...";
  refreshOptionsScan();
}

async function refreshOptionsScan() {
  try {
    const watchlist = encodeURIComponent(refs.watchlist.value);
    const payload = await getJson(`/api/options/scan?tickers=${watchlist}`);
    candidates = payload.candidates;
    renderCandidates(payload.source || "free source");
  } catch {
    window.setTimeout(() => renderCandidates("demo fallback"), 180);
  }
}

[refs.maxCost, refs.minProb, refs.minOi, refs.maxIv, refs.direction].forEach((control) => {
  control.addEventListener("input", renderCandidates);
});
refs.watchlist.value = book.settings.watchlist;
refs.watchlist.addEventListener("input", () => {
  book.settings.watchlist = refs.watchlist.value;
  saveBook();
});
refs.scanButton.addEventListener("click", scan);
refs.accountForm.addEventListener("submit", addAccount);
refs.exportBook.addEventListener("click", exportBook);
refs.importBook.addEventListener("change", importBook);
refs.positionForm.addEventListener("submit", addPosition);
refs.streamForm.addEventListener("submit", connectStream);
refs.streamDisconnect.addEventListener("click", disconnectStream);

renderMarketStrip();
refreshMarketSnapshot();
renderAccounts();
renderPositions();
renderCandidates();
renderSpotlight();
renderOrderStage();
renderStreamStatus("Not connected.");
renderStreamLast(null);
