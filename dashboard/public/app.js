/* Obsidian Flow — Dashboard */

let chart, candleSeries, volumeSeries;
let activeTicker = 'SPY';
let activeTF     = '5Min';
let ws;
let priceCache   = {};

const WATCHLIST = ['SPY','QQQ','NVDA','AMD','META','AAPL','TSLA','MSFT',
                   'DVN','OXY','COIN','BAC','SOFI','NIO','BBAI','PLTR','MARA'];

// ── Clock & market status ─────────────────────────────────────────────────────
function tick() {
  const now = new Date();
  const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = et.getHours(), m = et.getMinutes();
  const isOpen = et.getDay() >= 1 && et.getDay() <= 5 && (h > 9 || (h === 9 && m >= 30)) && h < 16;
  document.getElementById('clock').textContent =
    et.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ET';
  const badge = document.getElementById('mkt-badge');
  badge.textContent = isOpen ? 'MARKET OPEN' : 'MARKET CLOSED';
  badge.className   = 'market-badge ' + (isOpen ? 'open' : 'closed');
}
setInterval(tick, 1000);
tick();

// ── Chart ─────────────────────────────────────────────────────────────────────
function initChart() {
  const container = document.getElementById('chart-container');
  const el = document.getElementById('chart');
  el.style.width  = container.clientWidth  + 'px';
  el.style.height = container.clientHeight + 'px';

  chart = LightweightCharts.createChart(el, {
    width:  container.clientWidth,
    height: container.clientHeight,
    layout: { background: { color: '#05050f' }, textColor: '#475569' },
    grid:   { vertLines: { color: '#1c1c3a' }, horzLines: { color: '#1c1c3a' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: '#6d28d9', labelBackgroundColor: '#6d28d9' },
      horzLine: { color: '#6d28d9', labelBackgroundColor: '#6d28d9' },
    },
    rightPriceScale: { borderColor: '#1c1c3a', scaleMargins: { top: 0.1, bottom: 0.25 } },
    timeScale: { borderColor: '#1c1c3a', timeVisible: true, secondsVisible: false },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#34d399', downColor: '#f87171',
    borderUpColor: '#34d399', borderDownColor: '#f87171',
    wickUpColor: '#34d399', wickDownColor: '#f87171',
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'vol',
  });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

  new ResizeObserver(() => {
    chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  }).observe(container);

  loadChart(activeTicker);
}

async function loadChart(sym) {
  document.getElementById('ct-sym').textContent = sym;
  document.getElementById('ct-price').textContent = '—';
  document.getElementById('ct-chg').textContent = 'Loading...';

  try {
    const res  = await fetch(`/api/chart/${sym}?tf=${activeTF}`);
    const bars = await res.json();
    if (!Array.isArray(bars) || !bars.length) {
      document.getElementById('ct-chg').textContent = 'No chart data (market closed — crypto available)';
      return;
    }
    candleSeries.setData(bars);
    volumeSeries.setData(bars.map(b => ({
      time: b.time, value: b.volume ?? 0,
      color: b.close >= b.open ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)',
    })));
    chart.timeScale().fitContent();

    // Update toolbar from last bar vs prev bar
    const last = bars.at(-1);
    const prev = bars.length >= 2 ? bars.at(-2) : null;
    if (last) {
      const chg    = prev ? last.close - prev.close : 0;
      const chgPct = prev ? (chg / prev.close * 100) : 0;
      const up     = chg >= 0;
      const price  = priceCache[sym]?.extendedPrice ?? priceCache[sym]?.price ?? last.close;
      document.getElementById('ct-price').textContent = '$' + price.toFixed(2);
      document.getElementById('ct-price').className   = 'ct-price ' + (up ? 'up' : 'dn');
      document.getElementById('ct-chg').textContent   =
        (up ? '+' : '') + chg.toFixed(2) + ' (' + (up ? '+' : '') + chgPct.toFixed(2) + '%)' +
        (priceCache[sym]?.session && priceCache[sym].session !== 'regular' ? '  · ' + priceCache[sym].session.toUpperCase() : '');
      document.getElementById('ct-chg').className = 'ct-chg ' + (up ? 'up' : 'dn');
    }
  } catch(e) {
    document.getElementById('ct-chg').textContent = 'Chart error: ' + e.message;
  }
}

function setTF(tf, btn) {
  activeTF = tf;
  document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadChart(activeTicker);
}

function selectTicker(sym) {
  activeTicker = sym;
  document.querySelectorAll('.ticker-item').forEach(r => r.classList.remove('selected'));
  document.getElementById('ti-' + sym)?.classList.add('selected');
  loadChart(sym);
  // Auto-load options if that panel is visible
  const optPanel = document.getElementById('panel-options');
  if (optPanel.classList.contains('active')) loadOptions();
  // Populate expiry dropdown
  populateExpiries(sym);
}

async function populateExpiries(sym) {
  try {
    const expiries = await fetch(`/api/expiries/${sym}`).then(r => r.json());
    const sel = document.getElementById('opt-expiry');
    sel.innerHTML = '<option value="">Next</option>' +
      expiries.slice(0, 8).map(e => `<option value="${e}">${e}</option>`).join('');
  } catch {}
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen    = () => console.log('WS connected');
  ws.onclose   = () => setTimeout(connectWS, 3000);
  ws.onmessage = e => {
    try {
      const { type, data } = JSON.parse(e.data);
      if (type === 'prices') { priceCache = data; renderWatchlist(data); updateHeader(data); }
    } catch {}
  };
}

// ── Watchlist ─────────────────────────────────────────────────────────────────
function renderWatchlist(prices) {
  const wl = document.getElementById('watchlist');
  if (!Object.keys(prices).length) return;
  wl.innerHTML = Object.values(prices).map(q => {
    const up         = (q.changePct ?? 0) >= 0;
    const displayP   = q.extendedPrice ?? q.price;
    const isExtended = !!q.extendedPrice;
    const sessionTag = isExtended
      ? `<span style="font-size:8px;color:var(--yellow);margin-left:3px">${q.session==='afterhours'?'AH':'PM'}</span>`
      : '';
    return `<div class="ticker-item${q.symbol===activeTicker?' selected':''}" id="ti-${q.symbol}" onclick="selectTicker('${q.symbol}')">
      <span class="ti-sym">${q.symbol}${sessionTag}</span>
      <div class="ti-right">
        <div class="ti-price ${up?'up':'dn'}">$${displayP?.toFixed(2)??'—'}</div>
        <div class="ti-chg  ${up?'up':'dn'}">${up?'+':''}${q.changePct?.toFixed(2)??'—'}%</div>
      </div>
    </div>`;
  }).join('');
}

function updateHeader(prices) {
  const spy = prices['SPY'],  qqq = prices['QQQ'];
  if (spy) {
    const up = spy.changePct >= 0;
    document.getElementById('h-spy').textContent  = `$${spy.price?.toFixed(2)} ${up?'+':''}${spy.changePct?.toFixed(2)}%`;
    document.getElementById('h-spy').className    = 'hstat-val ' + (up?'up':'dn');
  }
  if (qqq) {
    const up = qqq.changePct >= 0;
    document.getElementById('h-qqq').textContent  = `$${qqq.price?.toFixed(2)} ${up?'+':''}${qqq.changePct?.toFixed(2)}%`;
    document.getElementById('h-qqq').className    = 'hstat-val ' + (up?'up':'dn');
  }
}

// ── Top Picks ─────────────────────────────────────────────────────────────────
const PICKS = [
  { ticker:'NIO',  contract:'NIO260605C00006000', type:'call', strike:6,    expiry:'Jun 5',  cost:17, prob:52.8, tags:['call'],                reason:'ATM call · 52.8% probability · high volume' },
  { ticker:'BBAI', contract:'BBAI260605C00005000',type:'call', strike:5,    expiry:'Jun 5',  cost:23, prob:54.0, tags:['call','itm'],           reason:'Slightly ITM · 54% probability · AI defense play' },
  { ticker:'AMC',  contract:'AMC260618C00002000', type:'call', strike:2,    expiry:'Jun 18', cost:20, prob:50.8, tags:['call','itm'],           reason:'Deep ITM · 15 DTE · high open interest' },
  { ticker:'SOFI', contract:'SOFI260605C00018500',type:'call', strike:18.5, expiry:'Jun 5',  cost:19, prob:16.5, tags:['call'],                 reason:'Near ATM · 2 DTE · fintech momentum' },
  { ticker:'DVN',  contract:'DVN260717C00055000', type:'call', strike:55,   expiry:'Jul 17', cost:13, prob:3.6,  tags:['call','flow','eia'],    reason:'$2M institutional sweep · EIA crude draw · 44 DTE' },
  { ticker:'COIN', contract:'COIN260618C00280000',type:'call', strike:280,  expiry:'Jun 18', cost:24, prob:32.6, tags:['call'],                 reason:'Best OTM probability · crypto momentum · 99% IV' },
  { ticker:'CORZ', contract:'CORZ260605C00031000',type:'call', strike:31,   expiry:'Jun 5',  cost:13, prob:24.9, tags:['call','flow'],          reason:'$411K floor sweep · AI HPC hosting play' },
  { ticker:'BAC',  contract:'BAC260612C00055000', type:'call', strike:55,   expiry:'Jun 12', cost:18, prob:13.3, tags:['call'],                 reason:'Financials coiling · 9 DTE · low IV' },
  { ticker:'OXY',  contract:'OXY260605C00060000', type:'call', strike:60,   expiry:'Jun 5',  cost:25, prob:8.5,  tags:['call','eia'],           reason:'Energy play · EIA bullish · 2 DTE' },
  { ticker:'ACHR', contract:'ACHR260605C00007000',type:'call', strike:7,    expiry:'Jun 5',  cost:13, prob:24.9, tags:['call'],                 reason:'eVTOL aviation · near ATM · 2 DTE' },
];

function renderPicks() {
  const el = document.getElementById('picks-list');
  document.getElementById('picks-loading').style.display = 'none';

  // Sort by probability descending
  const sorted = [...PICKS].sort((a,b) => b.prob - a.prob);

  el.innerHTML = sorted.map((p, i) => {
    const probColor = p.prob >= 40 ? 'var(--green)' : p.prob >= 20 ? 'var(--yellow)' : 'var(--muted)';
    const badges = p.tags.map(t => {
      const cls = t==='call'?'badge-call':t==='put'?'badge-put':t==='itm'?'badge-itm':t==='flow'?'badge-flow':'badge-eia';
      return `<span class="badge ${cls}">${t}</span>`;
    }).join('');

    return `<div class="pick-card" onclick="selectTicker('${p.ticker}')">
      <div class="pick-top">
        <div>
          <span style="font-size:11px;color:var(--muted);margin-right:6px">#${i+1}</span>
          <span class="pick-sym">${p.ticker}</span>
          <span style="margin-left:6px;font-size:11px;color:var(--sub)">$${p.strike} ${p.type.toUpperCase()}</span>
        </div>
        <span class="pick-cost">$${p.cost}/contract</span>
      </div>
      <div class="pick-contract">${p.contract} · ${p.expiry}</div>
      <div class="pick-prob-wrap">
        <div class="pick-prob-bar">
          <div class="pick-prob-fill" style="width:${Math.min(p.prob,100)}%;background:${p.prob>=40?'linear-gradient(90deg,var(--green),var(--cyan))':p.prob>=20?'linear-gradient(90deg,var(--yellow),var(--green))':'var(--muted)'}"></div>
        </div>
        <span class="pick-prob-pct" style="color:${probColor}">${p.prob}%</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div class="pick-badges">${badges}</div>
      </div>
      <div style="font-size:10px;color:var(--sub);margin-top:6px">${p.reason}</div>
      <button class="buy-btn" onclick="event.stopPropagation();openOrderModal(${JSON.stringify(p)})">
        Buy via Alpaca →
      </button>
    </div>`;
  }).join('');
}

// ── Options ───────────────────────────────────────────────────────────────────
async function loadOptions() {
  const budget  = document.getElementById('opt-budget').value || 500;
  const minProb = document.getElementById('opt-minprob').value || 0;
  const expiry  = document.getElementById('opt-expiry').value || '';
  const sort    = document.getElementById('opt-sort').value || 'prob';

  const params = new URLSearchParams({ budget, minProb, sort });
  if (expiry) params.set('expiry', expiry);

  document.getElementById('options-list').innerHTML = '<div class="loading">Loading options chain</div>';
  try {
    const res  = await fetch(`/api/options/${activeTicker}?${params}`);
    const opts = await res.json();
    if (opts.error) throw new Error(opts.error);
    if (!opts.length) {
      document.getElementById('options-list').innerHTML =
        `<div style="padding:20px;text-align:center;color:var(--muted)">
          <div style="font-size:24px;margin-bottom:8px">0</div>
          <div style="font-size:12px">No ${activeTicker} calls match your filters</div>
          <div style="font-size:11px;margin-top:6px;color:var(--sub)">Try: lower the Min Probability % or raise Max Cost</div>
        </div>`;
      return;
    }

    document.getElementById('options-list').innerHTML = `
      <div style="font-size:10px;color:var(--muted);margin-bottom:8px;padding:0 2px;display:flex;justify-content:space-between">
        <span><strong style="color:var(--cyan)">${activeTicker}</strong> calls · ${opts.length} contracts</span>
        <span>sorted by ${sort === 'cost' ? 'cheapest' : 'probability'}</span>
      </div>
      ${opts.map(o => {
        const pc = o.prob >= 40 ? 'var(--green)' : o.prob >= 20 ? 'var(--yellow)' : 'var(--sub)';
        const contractSymbol = o.symbol ?? `${activeTicker}...`;
        return `<div class="pick-card" style="padding:10px;cursor:pointer" onclick="openOrderModal({ticker:'${activeTicker}',contract:'${contractSymbol}',type:'call',strike:${o.strike},expiry:'${o.expiry?.slice(5)}',cost:${o.cost},prob:${o.prob},tags:['call']})">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div>
              <span style="font-size:13px;font-weight:700;color:var(--cyan)">${activeTicker}</span>
              <span style="font-size:13px;font-weight:700;margin-left:4px">$${o.strike}C</span>
              <span style="font-size:10px;color:var(--sub);margin-left:6px">exp ${o.expiry?.slice(5)}</span>
              ${o.itm?'<span style="font-size:9px;background:rgba(34,211,238,0.15);color:var(--cyan);border-radius:3px;padding:1px 5px;margin-left:4px">ITM</span>':''}
            </div>
            <span style="color:var(--green);font-weight:700;font-size:13px">$${o.cost}</span>
          </div>
          <div style="display:flex;gap:12px;font-size:10px;color:var(--muted);margin-bottom:6px">
            <span>IV ${o.iv??'—'}%</span>
            <span>Vol ${(o.volume??0).toLocaleString()}</span>
            <span>OI ${(o.oi??0).toLocaleString()}</span>
            <span>Δ ${o.delta??'—'}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden">
              <div style="height:100%;border-radius:3px;width:${Math.min(o.prob,100)}%;background:${o.prob>=40?'linear-gradient(90deg,var(--green),var(--cyan))':o.prob>=20?'var(--yellow)':'var(--muted)'}"></div>
            </div>
            <span style="font-weight:700;font-size:12px;min-width:52px;text-align:right;color:${pc}">${o.prob}% ITM</span>
          </div>
        </div>`;
      }).join('')}`;
  } catch(e) {
    document.getElementById('options-list').innerHTML = `<div style="color:var(--red);padding:12px">${e.message}</div>`;
  }
}

// ── Flow ──────────────────────────────────────────────────────────────────────
async function loadFlow() {
  try {
    const flow = await fetch('/api/flow').then(r => r.json());
    if (!flow.length) { document.getElementById('flow-list').innerHTML = '<div class="loading">No flow data</div>'; return; }
    document.getElementById('flow-list').innerHTML = flow.map(f => {
      const up = f.type === 'call';
      const prem = f.premium >= 1e6
        ? '$' + (f.premium/1e6).toFixed(2) + 'M'
        : '$' + (f.premium/1e3).toFixed(0) + 'K';
      return `<div class="flow-card ${f.type}" onclick="selectTicker('${f.ticker}')">
        <div class="flow-row1">
          <span class="flow-sym ${up?'up':'dn'}">${f.ticker}</span>
          <span class="flow-prem ${up?'up':'dn'}">${prem}</span>
        </div>
        <div class="flow-meta">${f.contract} · exp ${f.expiry} · ${f.daysToExpiry}d</div>
        <div style="display:flex;justify-content:space-between;margin-top:6px">
          <span class="badge ${up?'badge-call':'badge-put'}">${f.type}</span>
          <span class="flow-rule">${f.rule}</span>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    document.getElementById('flow-list').innerHTML = `<div style="color:var(--red);padding:12px">${e.message}</div>`;
  }
}

// ── Account ───────────────────────────────────────────────────────────────────
async function loadAccount() {
  try {
    const data = await fetch('/api/account').then(r => r.json());
    let html = '';

    if (data.alpaca?.account) {
      const a   = data.alpaca.account;
      const pnl = parseFloat(a.equity) - parseFloat(a.last_equity);
      const up  = pnl >= 0;
      html += `<div class="acct-card">
        <div class="acct-name">Alpaca · ${a.paper_trading?'Paper':'Live'}</div>
        <div class="acct-stat"><span class="acct-lbl">Portfolio Value</span><span class="acct-val">$${parseFloat(a.portfolio_value).toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
        <div class="acct-stat"><span class="acct-lbl">Buying Power</span><span class="acct-val">$${parseFloat(a.buying_power).toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
        <div class="acct-stat"><span class="acct-lbl">Today's P&L</span><span class="acct-val ${up?'up':'dn'}">${up?'+':''}$${Math.abs(pnl).toFixed(2)}</span></div>
        <div class="acct-stat"><span class="acct-lbl">Account #</span><span class="acct-val" style="color:var(--sub)">${a.account_number}</span></div>
      </div>`;

      if (data.alpaca.positions?.length) {
        html += `<div class="acct-card">
          <div class="acct-name">Open Positions</div>
          ${data.alpaca.positions.map(p => {
            const pnlP = parseFloat(p.unrealized_pl);
            return `<div class="acct-stat">
              <span class="acct-lbl">${p.symbol} <span style="color:var(--muted)">${p.qty} shares</span></span>
              <span class="acct-val ${pnlP>=0?'up':'dn'}">${pnlP>=0?'+':''}$${Math.abs(pnlP).toFixed(2)}</span>
            </div>`;
          }).join('')}
        </div>`;
      }
    }

    if (!html) {
      html = `<div class="acct-card">
        <div class="acct-name">Connected Brokers</div>
        <div class="connect-hint">
          Add keys to <strong>~/obsidian-flow/.env</strong> to see live account data:<br><br>
          <strong>Alpaca</strong> ✅ Connected<br>
          <strong>Tradier</strong> — awaiting approval<br>
          <strong>Coinbase</strong> — need private key<br>
          <strong>Tradovate</strong> — pending approval
        </div>
      </div>`;
    }

    document.getElementById('account-panel').innerHTML = html;
  } catch(e) {
    document.getElementById('account-panel').innerHTML = `<div style="color:var(--red);padding:12px">${e.message}</div>`;
  }
}

// ── Crypto bar ────────────────────────────────────────────────────────────────
async function loadCrypto() {
  try {
    const data = await fetch('/api/crypto').then(r => r.json());
    const map  = { 'BTC-USD': 'BTC', 'ETH-USD': 'ETH', 'SOL-USD': 'SOL', 'DOGE-USD': 'DOGE' };
    const el   = document.getElementById('crypto-list');
    el.innerHTML = data.map(c => {
      const sym = map[c.symbol] ?? c.symbol;
      const up  = (c.change24h ?? 0) >= 0;
      const price = c.price > 100 ? c.price.toFixed(2) : c.price.toFixed(4);
      return `<div class="crypto-item">
        <span class="ci-sym">${sym}</span>
        <span class="ci-price ${up?'up':'dn'}">$${price}</span>
      </div>`;
    }).join('');

    const btc = data.find(c => c.symbol === 'BTC-USD');
    if (btc) {
      const up = btc.change24h >= 0;
      document.getElementById('h-btc').textContent = `$${(btc.price/1000).toFixed(1)}K ${up?'+':''}${btc.change24h?.toFixed(1)}%`;
      document.getElementById('h-btc').className = 'hstat-val ' + (up?'up':'dn');
    }
  } catch {}
}

// ── Status ────────────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const s = await fetch('/api/status').then(r => r.json());
    const set = (id, on) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('on', on);
    };
    set('dot-alpaca',    s.brokers.alpaca);
    set('dot-tradier',   s.brokers.tradier);
    set('dot-coinbase',  s.brokers.coinbase);
    set('dot-tradovate', s.brokers.tradovate);
  } catch {}
}

// ── Intel tab ─────────────────────────────────────────────────────────────────
async function loadIntel() {
  // Wikipedia trending
  try {
    const tickers = ['AAPL','NVDA','TSLA','META','MSFT','AMD','COIN','PLTR','AMZN','GOOGL'];
    const wiki = await fetch('/api/wikipedia-batch?tickers=' + tickers.join(',')).then(r=>r.json());
    document.getElementById('wiki-list').innerHTML = (Array.isArray(wiki) && wiki.length)
      ? wiki.map(w => {
          const up = (w.trend ?? 0) >= 0;
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-weight:600;font-size:12px;cursor:pointer" onclick="selectTicker('${w.ticker}')">${w.ticker}</span>
            <span style="font-size:11px;color:var(--muted)">${(w.avg??0).toLocaleString()} avg/day</span>
            <span style="font-size:12px;font-weight:600;color:${up?'var(--green)':'var(--red)'}">${up?'▲':'▼'} ${Math.abs(w.trend??0)}%</span>
          </div>`;
        }).join('')
      : '<div style="color:var(--muted);font-size:11px;padding:8px 0">No Wikipedia data available</div>';
  } catch(e) {
    document.getElementById('wiki-list').innerHTML = `<div style="color:var(--muted);font-size:11px">${e.message}</div>`;
  }

  // Congressional trades
  try {
    const congress = await fetch('/api/congress').then(r=>r.json());
    document.getElementById('congress-list').innerHTML = (Array.isArray(congress) && congress.length)
      ? congress.slice(0,8).map(t => {
          const bull = t.signal === 'bullish';
          return `<div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:5px;border-left:3px solid ${bull?'var(--green)':'var(--red)'}">
            <div style="display:flex;justify-content:space-between">
              <span style="font-weight:700;cursor:pointer" onclick="selectTicker('${t.ticker}')">${t.ticker}</span>
              <span style="font-size:11px;color:${bull?'var(--green)':'var(--red)'}">${t.transaction}</span>
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:3px">${t.politician} (${t.party}) · ${t.amount} · ${t.reportDate}</div>
          </div>`;
        }).join('')
      : '<div style="color:var(--muted);font-size:11px;padding:8px 0">Add QUIVERQUANT_TOKEN to .env for congressional trade data</div>';
  } catch {
    document.getElementById('congress-list').innerHTML = '<div style="color:var(--muted);font-size:11px">Add QUIVERQUANT_TOKEN to .env</div>';
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function openTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
  if (name === 'options') { populateExpiries(activeTicker); loadOptions(); }
  if (name === 'intel')   loadIntel();
}

// ── Order Modal ───────────────────────────────────────────────────────────────
let currentOrder = null;
let selectedBroker = 'alpaca';

function openOrderModal(pick) {
  currentOrder = pick;
  selectedBroker = 'alpaca';

  document.getElementById('modal-title').textContent    = `Buy ${pick.ticker} ${pick.type.toUpperCase()}`;
  document.getElementById('modal-sub').textContent      = pick.contract;
  document.getElementById('modal-contract').textContent = pick.contract;
  document.getElementById('modal-type').textContent     = pick.type.toUpperCase() + ' · ' + (pick.tags.includes('itm') ? 'In the Money' : 'Out of the Money');
  document.getElementById('modal-strike').textContent   = `$${pick.strike} · exp ${pick.expiry}`;
  document.getElementById('modal-price').textContent    = `$${(pick.cost/100).toFixed(2)}/share ($${pick.cost}/contract)`;
  document.getElementById('modal-qty').value            = '1';
  document.getElementById('modal-limit').value          = (pick.cost / 100).toFixed(2);
  document.getElementById('chip-alpaca').classList.add('selected');
  document.getElementById('chip-coinbase').classList.remove('selected');

  updateModalTotal();
  document.getElementById('order-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('order-modal').classList.remove('open');
  currentOrder = null;
}

function selectBroker(broker) {
  selectedBroker = broker;
  document.querySelectorAll('.broker-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('chip-' + broker).classList.add('selected');
}

function updateModalTotal() {
  const qty   = parseInt(document.getElementById('modal-qty').value) || 1;
  const limit = parseFloat(document.getElementById('modal-limit').value) || 0;
  const total = (qty * limit * 100).toFixed(2);
  document.getElementById('modal-total').textContent = `Total cost: $${total} (${qty} contract${qty>1?'s':''} × $${(limit*100).toFixed(0)})`;
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-qty').addEventListener('input', updateModalTotal);
  document.getElementById('modal-limit').addEventListener('input', updateModalTotal);
  document.getElementById('order-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
});

async function submitOrder() {
  if (!currentOrder) return;
  const qty   = parseInt(document.getElementById('modal-qty').value) || 1;
  const limit = parseFloat(document.getElementById('modal-limit').value);
  const btn   = document.getElementById('modal-confirm');

  btn.disabled    = true;
  btn.textContent = 'Placing order...';

  try {
    const res = await fetch('/api/order', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        broker:     selectedBroker,
        symbol:     currentOrder.contract,
        side:       'buy',
        qty,
        type:       'limit',
        limitPrice: limit,
      }),
    });
    const data = await res.json();

    if (data.success) {
      showToast(`✓ Order placed! ${qty}x ${currentOrder.contract} via ${selectedBroker}`, 'success');
      closeModal();
      setTimeout(loadAccount, 2000); // refresh portfolio
    } else {
      showToast(`✗ ${data.error}`, 'error');
    }
  } catch(e) {
    showToast(`✗ ${e.message}`, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Confirm Order →';
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `show ${type}`;
  setTimeout(() => { el.className = ''; }, 4000);
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  initChart();
  connectWS();
  renderPicks();
  loadStatus();
  loadFlow();
  loadCrypto();
  loadAccount();

  setInterval(loadCrypto, 15_000);
  setInterval(loadFlow,   60_000);
  setInterval(loadStatus, 30_000);
  setInterval(loadAccount,120_000);
  populateExpiries(activeTicker);
});
