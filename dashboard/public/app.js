/* ═══════════════════════════════════════════════════════════════════════════
   Obsidian Flow — Financial Intelligence Terminal  v1.0
   ═══════════════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────────
let chart, candleSeries, volumeSeries;
let activeTicker = 'SPY';
let activeTF     = '5Min';
let activeBroker = 'alpaca';
let ws;
let priceCache   = {};
let prevPriceCache = {}; // For alert detection
let currentOrder = null;
let chartData = []; // Track loaded bars for real-time updates
let lastUpdate = 0; // Last time we updated the chart
const alertedThisCycle = new Set(); // Prevent duplicate alerts

const DEFAULT_WATCHLIST = ['SPY','QQQ','NVDA','AMD','META','AAPL','TSLA','MSFT',
                           'DVN','OXY','COIN','BAC','SOFI','NIO','BBAI','PLTR'];

// ── Watchlist (localStorage persisted) ───────────────────────────────────────
function getWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem('of_watchlist'));
    return saved?.length ? saved : [...DEFAULT_WATCHLIST];
  } catch { return [...DEFAULT_WATCHLIST]; }
}
function saveWatchlist(list) {
  localStorage.setItem('of_watchlist', JSON.stringify([...new Set(list)]));
}
function addTicker() {
  const input = document.getElementById('add-ticker');
  const sym   = input.value.trim().toUpperCase().replace(/[^A-Z]/g,'');
  if (!sym) return;
  const wl = getWatchlist();
  if (wl.includes(sym)) { showToast(`${sym} already in watchlist`, 'err'); input.value=''; return; }
  wl.unshift(sym);
  saveWatchlist(wl);
  input.value = '';
  // Fetch price for new ticker and add to cache
  fetch(`/api/quote/${sym}`).then(r=>r.json()).then(q => {
    priceCache[sym] = { symbol:sym, price:q.price, changePct:q.changePct, change:q.change, session:'regular' };
    renderWatchlist(priceCache);
  }).catch(() => renderWatchlist(priceCache));
  showToast(`${sym} added`, 'ok');
}
function removeTicker(sym) {
  const wl = getWatchlist().filter(t => t !== sym);
  saveWatchlist(wl);
  delete priceCache[sym];
  renderWatchlist(priceCache);
}

// ── Clock & market session ────────────────────────────────────────────────────
function tick() {
  const et   = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = et.getHours(), m = et.getMinutes(), day = et.getDay();
  const mins = h * 60 + m;
  const isWeekend = day === 0 || day === 6;
  const isOpen    = !isWeekend && mins >= 570 && mins < 960;
  const isAH      = !isWeekend && mins >= 960 && mins < 1200;
  const isPM      = !isWeekend && mins >= 240 && mins < 570;

  const timeStr = et.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  document.getElementById('clock').textContent = timeStr + ' ET';

  const mkt = document.getElementById('mkt');
  if (isOpen)      { mkt.textContent='MARKET OPEN';   mkt.className='mkt-pill mkt-open'; }
  else if (isAH)   { mkt.textContent='AFTER HOURS';   mkt.className='mkt-pill'; mkt.style.cssText='background:rgba(251,191,36,.1);color:#fbbf24;border:1px solid rgba(251,191,36,.3);padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;'; }
  else if (isPM)   { mkt.textContent='PRE-MARKET';    mkt.className='mkt-pill'; mkt.style.cssText='background:rgba(34,211,238,.1);color:#22d3ee;border:1px solid rgba(34,211,238,.3);padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;'; }
  else             { mkt.textContent='MARKET CLOSED'; mkt.className='mkt-pill mkt-closed'; mkt.style.cssText=''; }
}
setInterval(tick, 1000); tick();

// ── Page routing ──────────────────────────────────────────────────────────────
function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
  if (name === 'algo')    loadAlgoPage();
  if (name === 'news')    loadNewsPage();
  if (name === 'account') loadAccountPage();
  if (name === 'picks')   loadSpotlightPage();
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function initChart() {
  const wrap = document.getElementById('chart-wrap');
  const el   = document.getElementById('chart');
  el.style.width  = wrap.clientWidth  + 'px';
  el.style.height = wrap.clientHeight + 'px';

  chart = LightweightCharts.createChart(el, {
    width:  wrap.clientWidth,
    height: wrap.clientHeight,
    layout: { background:{ color:'#080818' }, textColor:'#4b5563' },
    grid:   { vertLines:{ color:'#1a1a3a' }, horzLines:{ color:'#1a1a3a' } },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine:{ color:'#7c3aed', labelBackgroundColor:'#7c3aed' },
      horzLine:{ color:'#7c3aed', labelBackgroundColor:'#7c3aed' },
    },
    rightPriceScale: { borderColor:'#1a1a3a', scaleMargins:{ top:0.1, bottom:0.25 } },
    timeScale: { borderColor:'#1a1a3a', timeVisible:true, secondsVisible:false },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor:'#34d399', downColor:'#f87171',
    borderUpColor:'#34d399', borderDownColor:'#f87171',
    wickUpColor:'#34d399', wickDownColor:'#f87171',
  });
  volumeSeries = chart.addHistogramSeries({ priceFormat:{ type:'volume' }, priceScaleId:'vol' });
  chart.priceScale('vol').applyOptions({ scaleMargins:{ top:0.82, bottom:0 } });

  new ResizeObserver(() => chart.applyOptions({ width:wrap.clientWidth, height:wrap.clientHeight })).observe(wrap);
  loadChart(activeTicker);
}

async function loadChart(sym) {
  document.getElementById('ct-sym').textContent   = sym;
  document.getElementById('ct-price').textContent = '—';
  document.getElementById('ct-chg').textContent   = '';
  try {
    const bars = await fetch(`/api/chart/${sym}?tf=${activeTF}`).then(r=>r.json());
    if (!Array.isArray(bars) || !bars.length) return;
    chartData = [...bars]; // Store for real-time updates
    lastCandleTime = bars.at(-1)?.time || 0;
    candleSeries.setData(bars);
    volumeSeries.setData(bars.map(b => ({
      time: b.time, value: b.volume ?? 0,
      color: b.close >= b.open ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)',
    })));
    chart.timeScale().fitContent();
    // Header update from cache or last bar
    const last = bars.at(-1);
    const prev = bars.at(-2);
    const q    = priceCache[sym];
    const dp   = q?.extendedPrice ?? q?.price ?? last?.close;
    if (dp) {
      const chg = prev ? last.close - prev.close : 0;
      const pct = prev ? chg / prev.close * 100 : 0;
      const up  = pct >= 0;
      const sess= q?.session;
      document.getElementById('ct-price').textContent = '$' + dp.toFixed(2);
      document.getElementById('ct-price').className   = 'chart-price ' + (up?'up':'dn');
      document.getElementById('ct-chg').textContent   =
        (up?'+':'') + chg.toFixed(2) + ' (' + (up?'+':'') + pct.toFixed(2) + '%)' +
        (sess && sess !== 'regular' && sess !== 'closed' ? '  ·  ' + sess.toUpperCase() : '');
      document.getElementById('ct-chg').className = 'chart-chg ' + (up?'up':'dn');
    }
  } catch(e) { document.getElementById('ct-chg').textContent = 'Chart unavailable'; }
}

function setTF(tf, btn) {
  activeTF = tf;
  document.querySelectorAll('.tf').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  loadChart(activeTicker);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen    = () => {};
  ws.onclose   = () => setTimeout(connectWS, 3000);
  ws.onmessage = e => {
    try {
      const { type, data } = JSON.parse(e.data);
      if (type === 'prices') {
        // Check for big movers before updating cache
        for (const [sym, q] of Object.entries(data)) {
          const prev = prevPriceCache[sym];
          if (prev?.price && q.price && !alertedThisCycle.has(sym)) {
            const pct = (q.price - prev.price) / prev.price * 100;
            if (Math.abs(pct) >= 2) {
              alertedThisCycle.add(sym);
              showToast(`${sym} ${pct>0?'▲':'▼'} ${Math.abs(pct).toFixed(1)}% — $${q.price.toFixed(2)}`, pct>0?'ok':'err');
              setTimeout(() => alertedThisCycle.delete(sym), 300000); // re-alert after 5min
            }
          }
        }
        prevPriceCache = { ...priceCache };
        priceCache = data;
        renderWatchlist(data);
        updateHeader(data);
        // Real-time chart update for active ticker
        if (data[activeTicker] && chartData.length && candleSeries) {
          const q = data[activeTicker];
          const last = chartData.at(-1);
          if (last && q.price) {
            const newHigh = Math.max(last.high || last.close, q.price);
            const newLow = Math.min(last.low || last.close, q.price);
            candleSeries.update({ ...last, high: newHigh, low: newLow, close: q.price });
          }
        }
      }
    } catch {}
  };
}

// ── Watchlist render ──────────────────────────────────────────────────────────
function renderWatchlist(prices) {
  const wl   = document.getElementById('watchlist');
  const list = getWatchlist();
  if (!list.length) return;

  wl.innerHTML = list.map(sym => {
    const q    = prices[sym] ?? {};
    const up   = (q.changePct ?? 0) >= 0;
    const dp   = q.extendedPrice ?? q.price;
    const ext  = q.extendedPrice
      ? `<span class="tick-ext">${q.session==='afterhours'?'AH':'PM'}</span>` : '';
    const priceStr = dp ? `$${dp.toFixed(2)}` : '<span style="opacity:.3">—</span>';
    const chgStr   = q.changePct != null ? `${up?'+':''}${q.changePct.toFixed(2)}%` : '';
    return `<div class="tick${sym===activeTicker?' sel':''}" id="ti-${sym}" onclick="selectTicker('${sym}')">
      <div><span class="tick-sym">${sym}</span>${ext}</div>
      <div class="tick-right">
        <div class="tick-price ${up?'up':'dn'}">${priceStr}</div>
        <div class="tick-chg ${up?'up':'dn'}">${chgStr}</div>
      </div>
      <button class="tick-del" onclick="event.stopPropagation();removeTicker('${sym}')">✕</button>
    </div>`;
  }).join('');
}

function updateHeader(prices) {
  const spy = prices['SPY'], qqq = prices['QQQ'];
  if (spy) { const up=spy.changePct>=0; document.getElementById('h-spy').textContent=`$${spy.price?.toFixed(2)} ${up?'+':''}${spy.changePct?.toFixed(2)}%`; document.getElementById('h-spy').className='hstat-val '+(up?'up':'dn'); }
  if (qqq) { const up=qqq.changePct>=0; document.getElementById('h-qqq').textContent=`$${qqq.price?.toFixed(2)} ${up?'+':''}${qqq.changePct?.toFixed(2)}%`; document.getElementById('h-qqq').className='hstat-val '+(up?'up':'dn'); }
}

function selectTicker(sym) {
  activeTicker = sym;
  document.querySelectorAll('.tick').forEach(t => t.classList.remove('sel'));
  document.getElementById('ti-' + sym)?.classList.add('sel');
  loadChart(sym);
  // If options pane is visible, reload
  if (document.getElementById('pane-options').classList.contains('on')) {
    populateExpiries(sym);
    loadOptions();
  }
  // Load news for this ticker in news tab
  if (document.getElementById('pane-news-tab').classList.contains('on')) loadNewsTab(sym);
}

// ── Tradovate account selection ────────────────────────────────────────────────
async function selectTradovateAccount(acctNum) {
  try {
    await fetch('/api/tradovate/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountNum: acctNum }) });
    document.getElementById('tv-acct-1').classList.toggle('act', acctNum === 1);
    document.getElementById('tv-acct-2').classList.toggle('act', acctNum === 2);
    showToast(`Switched to Tradovate account ${acctNum}`, 'ok');
  } catch(e) { showToast('Failed to switch account', 'err'); }
}

// ── LLM model selection ────────────────────────────────────────────────────────
function selectModel(model) {
  localStorage.setItem('selectedModel', model);
  const labels = { claude: 'Claude (Haiku)', gpt: 'GPT-4o', gemini: 'Gemini' };
  showToast(`AI model: ${labels[model]}`, 'ok');
}

// ── Top Picks (Smart Money + Earnings) ────────────────────────────────────────
async function loadTopPicks() {
  try {
    const container = document.getElementById('top-picks-list') || document.querySelector('.picks-grid');
    if (!container) return;
    container.innerHTML = '<div class="loading spin" style="grid-column:1/-1">Scanning smart money...</div>';

    const picks = await fetch('/api/top-picks').then(r => r.json()).then(d => d.picks || []);

    if (!picks.length) {
      container.innerHTML = '<div style="grid-column:1/-1;padding:24px;text-align:center;color:var(--muted)">No smart money plays detected right now</div>';
      return;
    }

    container.innerHTML = picks.map(p => {
      const premium = p.netPremium >= 1_000_000
        ? `$${(p.netPremium/1_000_000).toFixed(1)}M`
        : `$${(p.netPremium/1000).toFixed(0)}K`;
      const bullColor = p.score >= 70 ? '#34d399' : p.score >= 50 ? '#fbbf24' : '#f87171';
      return `
      <div class="pick-card" onclick="selectTicker('${p.ticker}');showPage('terminal',document.querySelector('.nav-link'))" style="cursor:pointer">
        <div class="pick-header" style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div>
            <span style="font-size:16px;font-weight:800;color:var(--cyan)">${p.ticker}</span>
            ${p.topSignal ? `<div style="font-size:9px;color:var(--accent);font-weight:600;margin-top:2px">${p.topSignal}</div>` : ''}
          </div>
          <div style="text-align:right">
            <div style="font-size:13px;font-weight:700;color:${bullColor}">${p.score}% BULL</div>
            <div style="font-size:9px;color:var(--muted)">${p.alertCount} alerts</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px;margin-bottom:8px">
          <div style="background:var(--s2);padding:6px;border-radius:4px;text-align:center">
            <div style="color:var(--muted);margin-bottom:2px">Net Smart $</div>
            <div style="font-weight:700;color:#34d399">${premium}</div>
          </div>
          <div style="background:var(--s2);padding:6px;border-radius:4px;text-align:center">
            <div style="color:var(--muted);margin-bottom:2px">IV</div>
            <div style="font-weight:700;color:var(--cyan)">${p.iv ?? '—'}%</div>
          </div>
          <div style="background:var(--s2);padding:6px;border-radius:4px;text-align:center">
            <div style="color:var(--muted);margin-bottom:2px">Top Strike</div>
            <div style="font-weight:700">$${p.topStrike ?? '—'}</div>
          </div>
          <div style="background:var(--s2);padding:6px;border-radius:4px;text-align:center">
            <div style="color:var(--muted);margin-bottom:2px">Exp</div>
            <div style="font-weight:700">${p.topExpiry?.slice(5) ?? '—'} (${p.daysToExpiry}d)</div>
          </div>
        </div>
        <div style="background:rgba(122,61,237,0.15);border:1px solid #7c3aed33;border-radius:4px;padding:5px 8px;font-size:9px;color:var(--muted);display:flex;justify-content:space-between">
          <span>📞 $${(p.callPremium/1000).toFixed(0)}K calls</span>
          <span>📉 $${(p.putPremium/1000).toFixed(0)}K puts</span>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('Top picks error:', e);
    const container = document.getElementById('top-picks-list') || document.querySelector('.picks-grid');
    if (container) container.innerHTML = `<div style="color:var(--red);grid-column:1/-1;padding:12px">${e.message}</div>`;
  }
}

// ── Crypto bar ────────────────────────────────────────────────────────────────
async function loadCrypto() {
  try {
    const data = await fetch('/api/crypto').then(r=>r.json());
    const map  = { 'BTC-USD':'BTC','ETH-USD':'ETH','SOL-USD':'SOL','DOGE-USD':'DOGE' };
    const el   = document.getElementById('crypto-list');
    el.innerHTML = data.map(c => {
      const sym = map[c.symbol]??c.symbol;
      const up  = (c.change24h??0) >= 0;
      const p   = c.price > 100 ? c.price.toFixed(2) : c.price.toFixed(4);
      return `<div class="crypto-row"><span class="crypto-sym">${sym}</span><span class="crypto-p ${up?'up':'dn'}">$${p}</span></div>`;
    }).join('');
    const btc = data.find(c => c.symbol==='BTC-USD');
    if (btc) {
      const up = btc.change24h >= 0;
      document.getElementById('h-btc').textContent = `$${(btc.price/1000).toFixed(1)}K ${up?'+':''}${btc.change24h?.toFixed(1)}%`;
      document.getElementById('h-btc').className   = 'hstat-val '+(up?'up':'dn');
    }
  } catch {}
}

// ── Status dots ───────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const s = await fetch('/api/status').then(r=>r.json());
    const set = (id, on) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = 'bpill ' + (on ? 'on' : 'off');
    };
    set('bp-alpaca',    s.brokers.alpaca);
    set('bp-coinbase',  s.brokers.coinbase);
    set('bp-tradier',   s.brokers.tradier);
  } catch {}
}

// ── Tab panel switching ───────────────────────────────────────────────────────
function openTab(name, btn) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('pane-' + name).classList.add('on');
  if (name === 'options')  { populateExpiries(activeTicker); loadOptions(); }
  if (name === 'flow')     loadFlow();
  if (name === 'news-tab') loadNewsTab(activeTicker);
  if (name === 'intel')    loadIntel();
  if (name === 'darkpool') loadDarkPool();
  if (name === 'ai-agent') loadAIAgent();
}

// ── Top Picks (terminal pane) ─────────────────────────────────────────────────
const PICKS = [
  { ticker:'NIO',  contract:'NIO260605C00006000', type:'call', strike:6,   expiry:'Jun 5',  cost:17, prob:52.8, tags:['call'],      reason:'ATM call · 52.8% probability · high volume' },
  { ticker:'BBAI', contract:'BBAI260605C00005000',type:'call', strike:5,   expiry:'Jun 5',  cost:23, prob:54.0, tags:['call','itm'],reason:'Slightly ITM · 54% probability · AI defense' },
  { ticker:'AMC',  contract:'AMC260618C00002000', type:'call', strike:2,   expiry:'Jun 18', cost:20, prob:50.8, tags:['call','itm'],reason:'Deep ITM · 15 DTE · massive open interest' },
  { ticker:'DVN',  contract:'DVN260717C00055000', type:'call', strike:55,  expiry:'Jul 17', cost:13, prob:3.6,  tags:['call','eia'],reason:'$2M institutional sweep · EIA crude draw' },
  { ticker:'COIN', contract:'COIN260618C00280000',type:'call', strike:280, expiry:'Jun 18', cost:24, prob:32.6, tags:['call'],      reason:'Highest OTM probability · crypto momentum' },
  { ticker:'SOFI', contract:'SOFI260605C00018500',type:'call', strike:18.5,expiry:'Jun 5',  cost:19, prob:16.5, tags:['call'],      reason:'Near ATM · 2 DTE · fintech momentum' },
  { ticker:'CORZ', contract:'CORZ260605C00031000',type:'call', strike:31,  expiry:'Jun 5',  cost:13, prob:24.9, tags:['call'],      reason:'$411K floor sweep · AI HPC hosting' },
  { ticker:'OXY',  contract:'OXY260605C00060000', type:'call', strike:60,  expiry:'Jun 5',  cost:25, prob:8.5,  tags:['eia'],       reason:'Energy coil · EIA crude draw · 2 DTE' },
];

function renderTerminalPicks() {
  document.getElementById('picks-loading').style.display = 'none';
  const sorted = [...PICKS].sort((a,b) => b.prob - a.prob);
  document.getElementById('picks-list').innerHTML = sorted.map((p,i) => {
    const pc   = p.prob>=40?'#34d399':p.prob>=20?'#fbbf24':'#4b5563';
    const tags = p.tags.map(t => `<span class="badge ${t==='call'?'badge-g':t==='itm'?'badge-c':t==='eia'?'badge-a':'badge-r'}">${t}</span>`).join(' ');
    return `<div class="card" style="cursor:pointer" onclick="selectTicker('${p.ticker}')">
      <div class="row" style="margin-bottom:4px">
        <div>
          <span style="font-size:11px;color:var(--muted)">#${i+1}</span>
          <span style="font-size:14px;font-weight:700;margin-left:5px;color:var(--cyan)">${p.ticker}</span>
          <span style="font-size:12px;font-weight:600;margin-left:4px">$${p.strike}C</span>
        </div>
        <span style="color:var(--green);font-weight:700;font-size:13px">$${p.cost}</span>
      </div>
      <div style="font-size:10px;color:var(--sub);margin-bottom:7px">${p.contract} · ${p.expiry}</div>
      <div class="row" style="margin-bottom:4px">
        <div class="prob-bar" style="flex:1;margin-right:8px">
          <div class="prob-fill" style="width:${Math.min(p.prob,100)}%;background:${pc}"></div>
        </div>
        <span style="font-weight:700;font-size:12px;color:${pc};min-width:44px;text-align:right">${p.prob}%</span>
      </div>
      <div class="row" style="margin-top:6px">
        <div style="display:flex;gap:4px">${tags}</div>
      </div>
      <div style="font-size:10px;color:var(--sub);margin-top:5px">${p.reason}</div>
      <button class="f-btn" style="width:100%;margin-top:8px;padding:7px" onclick="event.stopPropagation();openOrderModal(${JSON.stringify(p)})">Buy via Alpaca →</button>
    </div>`;
  }).join('');
}

// ── Options ───────────────────────────────────────────────────────────────────
async function populateExpiries(sym) {
  try {
    const expiries = await fetch(`/api/expiries/${sym}`).then(r=>r.json());
    const sel = document.getElementById('opt-expiry');
    sel.innerHTML = '<option value="">Next</option>' +
      (expiries||[]).slice(0,10).map(e => `<option value="${e}">${e}</option>`).join('');
  } catch {}
}

async function loadOptions() {
  const budget  = document.getElementById('opt-budget').value  || 500;
  const minProb = document.getElementById('opt-minprob').value || 0;
  const expiry  = document.getElementById('opt-expiry').value  || '';
  const sort    = document.getElementById('opt-sort').value    || 'prob';
  const params  = new URLSearchParams({ budget, minProb, sort });
  if (expiry) params.set('expiry', expiry);

  document.getElementById('options-list').innerHTML = `<div class="loading spin">Loading ${activeTicker} options</div>`;
  try {
    const opts = await fetch(`/api/options/${activeTicker}?${params}`).then(r=>r.json());
    if (opts.error) throw new Error(opts.error);
    if (!opts.length) {
      document.getElementById('options-list').innerHTML =
        `<div style="padding:20px;text-align:center">
          <div style="font-size:32px;margin-bottom:8px;opacity:.3">∅</div>
          <div style="font-size:12px;color:var(--muted)">No ${activeTicker} calls match filters</div>
          <div style="font-size:11px;color:var(--sub);margin-top:4px">Try lowering Min Probability or raising Max Cost</div>
        </div>`;
      return;
    }

    // Load backtesting + VIX context + earnings
    const [backtest, vix, earnings] = await Promise.allSettled([
      fetch(`/api/backtest/${activeTicker}`).then(r=>r.json()),
      fetch('/api/vix').then(r=>r.json()),
      fetch(`/api/earnings/${activeTicker}`).then(r=>r.json())
    ]);

    let btHtml = '';
    if (backtest.status === 'fulfilled' && backtest.value.stats) {
      const s = backtest.value.stats;
      const regimeColor = vix.status === 'fulfilled' && vix.value.regime === 'high' ? '#f87171' :
                         vix.status === 'fulfilled' && vix.value.regime === 'low' ? '#60a5fa' : '#fbbf24';
      const vixPrice = vix.status === 'fulfilled' ? vix.value.vix.price.toFixed(1) : '—';
      const ivRankLabel = vix.status === 'fulfilled' ? vix.value.ivRankLabel : '—';
      const ivRankColor = vix.status === 'fulfilled' && vix.value.ivRankLabel === 'expensive' ? '#f87171' :
                         vix.status === 'fulfilled' && vix.value.ivRankLabel === 'cheap' ? '#34d399' : '#fbbf24';
      const earningsWarn = earnings.status === 'fulfilled' && earnings.value.warning ?
        `<div style="color:#f87171;font-size:10px;margin-top:6px">${earnings.value.warning}</div>` : '';

      btHtml = `
        <div style="background:rgba(122,61,237,0.1);border:1px solid #7c3aed;border-radius:6px;padding:12px;margin-bottom:12px;font-size:11px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span style="color:var(--muted)"><strong>Backtest (30d) + Context</strong></span>
            <span style="color:${regimeColor};font-weight:700">VIX ${vixPrice}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">
            <div><span style="color:var(--muted)">Win Rate:</span> <span style="color:var(--cyan)">${s.winRate}%</span></div>
            <div><span style="color:var(--muted)">Profit Factor:</span> <span style="color:${s.profitFactor > 1.5 ? '#34d399' : '#fbbf24'}">${s.profitFactor}</span></div>
            <div><span style="color:var(--muted)">IV Rank:</span> <span style="color:${ivRankColor}">${ivRankLabel}</span></div>
            <div><span style="color:var(--muted)">P/L:</span> <span style="color:${s.totalPL > 0 ? '#34d399' : '#f87171'}">$${s.totalPL}</span></div>
          </div>
          ${earningsWarn}
        </div>`;
    }

    document.getElementById('options-list').innerHTML =
      btHtml +
      `<div style="font-size:10px;color:var(--muted);margin-bottom:8px;display:flex;justify-content:space-between">
        <span><strong style="color:var(--cyan)">${activeTicker}</strong> · ${opts.length} contracts · Real Greeks from Tradier</span>
        <span style="color:var(--sub)">${sort==='cost'?'cheapest first':'highest prob first'}</span>
      </div>` +
      opts.map(o => {
        const pc = o.prob>=40?'#34d399':o.prob>=20?'#fbbf24':'#4b5563';
        const spreadWarning = o.spreadPct > 3 ? ' ⚠️ wide' : '';
        const earningsAlert = o.earningsWarning ? `<div style="color:#f87171;font-size:9px;margin-top:4px;font-weight:600">${o.earningsWarning}</div>` : '';
        const smartMoneyLabel = o.smartMoneySignal ? `<span class="badge" style="background:#7c3aed;color:#fff;font-size:8px;padding:2px 6px;border-radius:3px;font-weight:600">🤖 ${o.smartMoneySignal}</span>` : '';
        const premiumLabel = o.smartMoneyPremium ? `$${(o.smartMoneyPremium/1000).toFixed(0)}K` : '—';
        return `<div class="card" onclick="openOrderModal({ticker:'${activeTicker}',contract:'${o.symbol}',type:'call',strike:${o.strike},expiry:'${o.expiry?.slice(5)}',cost:${o.cost},prob:${o.prob},tags:['call']${o.itm?",\'itm\'":''}})" style="cursor:pointer">
          <div class="row" style="margin-bottom:6px">
            <div>
              <span style="font-size:13px;font-weight:700;color:var(--cyan)">${activeTicker}</span>
              <span style="font-size:13px;font-weight:700;margin-left:4px">$${o.strike}C</span>
              <span style="font-size:10px;color:var(--sub);margin-left:6px">exp ${o.expiry?.slice(5)}</span>
              ${o.itm?'<span class="badge badge-c" style="margin-left:5px">ITM</span>':''}
            </div>
            <div style="text-align:right">
              <div style="color:var(--green);font-weight:700">$${o.ask}</div>
              <div style="font-size:9px;color:var(--muted)">Smart $${premiumLabel}</div>
            </div>
          </div>
          ${smartMoneyLabel ? `<div style="margin-bottom:6px">${smartMoneyLabel}</div>` : ''}
          <div style="display:flex;gap:10px;font-size:10px;color:var(--muted);margin-bottom:5px;flex-wrap:wrap">
            <span>IV ${o.iv??'—'}%</span><span>Vol ${(o.volume??0).toLocaleString()}</span><span>OI ${(o.openInterest??0).toLocaleString()}</span><span>Δ ${o.delta}</span><span style="color:var(--sub)">${spreadWarning}</span>
          </div>
          <div style="font-size:9px;color:var(--sub);margin-bottom:5px;display:grid;grid-template-columns:1fr 1fr">
            <span>Max Loss: $${o.maxLoss}</span>
            <span>Breakeven: $${o.breakeven}</span>
            <span>Exit at: $${o.targetPrice}</span>
            <span>Conviction: ${o.smartMoneyPremium ? '🔥' : '—'}</span>
          </div>
          ${earningsAlert}
          <div class="row" style="margin-top:6px">
            <div class="prob-bar" style="flex:1;margin-right:8px">
              <div class="prob-fill" style="width:${Math.min(o.prob,100)}%;background:${o.prob>=40?'linear-gradient(90deg,#34d399,#22d3ee)':pc}"></div>
            </div>
            <span style="font-weight:700;font-size:12px;color:${pc};min-width:56px;text-align:right">${o.prob}% ITM</span>
          </div>
          <button onclick="event.stopPropagation();analyzeOption(this,${JSON.stringify(o).replace(/'/g,'&apos;')})" style="width:100%;margin-top:8px;padding:5px;background:rgba(122,61,237,0.2);border:1px solid #7c3aed55;color:var(--accent);font-size:10px;border-radius:4px;cursor:pointer;font-family:inherit">🤖 Ask AI</button>
          <div class="ai-analysis-box" style="display:none;margin-top:8px;background:rgba(0,0,0,0.3);border:1px solid #7c3aed33;border-radius:4px;padding:8px;font-size:10px;color:var(--muted);white-space:pre-wrap;line-height:1.5"></div>
        </div>`;
      }).join('');
  } catch(e) {
    document.getElementById('options-list').innerHTML = `<div style="color:var(--red);padding:12px">${e.message}</div>`;
  }
}

// ── AI Analysis ───────────────────────────────────────────────────────────────
async function analyzeOption(btn, opt) {
  const box = btn.nextElementSibling;
  if (box.style.display !== 'none') { box.style.display = 'none'; btn.textContent = '🤖 Ask AI'; return; }

  btn.textContent = '⏳ Analyzing...';
  btn.disabled = true;
  box.style.display = 'block';
  box.textContent = 'Getting AI analysis...';

  try {
    const price = priceCache[activeTicker]?.price ?? opt.underlying ?? 0;
    const data = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: activeTicker,
        strike: opt.strike,
        expiry: opt.expiry,
        ask: opt.ask,
        delta: opt.delta,
        iv: opt.iv,
        smartMoneyPremium: opt.smartMoneyPremium ?? 0,
        signal: opt.smartMoneySignal ?? 'Unknown',
        currentPrice: price,
      }),
    }).then(r => r.json());

    box.textContent = data.analysis ?? data.error ?? 'No analysis returned';
    btn.textContent = '🤖 Hide AI';
  } catch(e) {
    box.textContent = 'Analysis failed: ' + e.message;
    btn.textContent = '🤖 Ask AI';
  } finally {
    btn.disabled = false;
  }
}

// ── Flow ──────────────────────────────────────────────────────────────────────
async function loadFlow() {
  try {
    const flow = await fetch('/api/flow').then(r=>r.json());
    if (!flow.length) { document.getElementById('flow-list').innerHTML = '<div class="loading">No flow data</div>'; return; }
    document.getElementById('flow-list').innerHTML = flow.map(f => {
      const bull = f.type==='call';
      const prem = f.premium>=1e6 ? '$'+(f.premium/1e6).toFixed(2)+'M' : '$'+(f.premium/1e3).toFixed(0)+'K';
      return `<div class="card fcol ${f.type}" onclick="selectTicker('${f.ticker}')" style="cursor:pointer">
        <div class="row">
          <span style="font-size:13px;font-weight:700;color:${bull?'#34d399':'#f87171'}">${f.ticker}</span>
          <span style="font-size:13px;font-weight:700;color:${bull?'#34d399':'#f87171'}">${prem}</span>
        </div>
        <div style="font-size:10px;color:var(--sub);margin-top:3px">${f.contract} · exp ${f.expiry} · ${f.daysToExpiry}d</div>
        <div class="row" style="margin-top:5px">
          <span class="badge ${bull?'badge-g':'badge-r'}">${f.type}</span>
          <span style="font-size:10px;color:var(--muted);font-style:italic">${f.rule}</span>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    document.getElementById('flow-list').innerHTML = `<div style="color:var(--red);padding:12px">${e.message}</div>`;
  }
}

// ── News Tab (in terminal) ────────────────────────────────────────────────────
async function loadNewsTab(ticker) {
  document.getElementById('news-tab-content').innerHTML = `<div class="loading spin">Loading ${ticker} news</div>`;
  try {
    const news = await fetch(`/api/news/${ticker}`).then(r=>r.json());
    if (!news.length) { document.getElementById('news-tab-content').innerHTML = '<div class="loading">No recent news</div>'; return; }
    document.getElementById('news-tab-content').innerHTML = news.map(n => {
      const age = timeAgo(new Date(n.publishedAt));
      return `<div class="card" onclick="window.open('${n.link}','_blank')" style="cursor:pointer">
        <div style="font-size:10px;color:var(--muted);margin-bottom:4px;display:flex;justify-content:space-between">
          <span>${n.publisher}</span><span>${age}</span>
        </div>
        <div style="font-size:12px;font-weight:600;line-height:1.4">${n.title}</div>
        ${n.relatedTickers?.length ? `<div style="margin-top:5px;display:flex;gap:4px;flex-wrap:wrap">${n.relatedTickers.slice(0,5).map(t=>`<span class="badge badge-a">${t}</span>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
  } catch(e) {
    document.getElementById('news-tab-content').innerHTML = `<div style="color:var(--red);padding:12px">${e.message}</div>`;
  }
}

// ── AI Agent Tab ──────────────────────────────────────────────────────────────
async function loadAIAgent() {
  const el = document.getElementById('ai-agent-picks');
  el.innerHTML = `<div class="loading spin">Scanning multi-signal matrix...</div>`;
  try {
    const result = await fetch('/api/market-intelligence').then(r => r.json());
    if (!result.picks || !result.picks.length) {
      el.innerHTML = `<div style="color:var(--muted);padding:20px;text-align:center">No strong signals detected right now</div>`;
      document.getElementById('ai-agent-insight').style.display = 'none';
      return;
    }

    el.innerHTML = result.picks.map(p => `
      <div class="card" onclick="selectTicker('${p.ticker}');showPage('terminal',document.querySelector('.nav-link'))" style="cursor:pointer;margin-bottom:8px">
        <div class="row" style="margin-bottom:6px">
          <div>
            <span style="font-size:14px;font-weight:800;color:var(--cyan)">${p.ticker}</span>
            <span class="badge" style="background:${
              p.verdict === 'STRONG BUY' ? '#34d399' :
              p.verdict === 'BUY' ? '#fbbf24' : '#4b5563'
            };color:#fff;margin-left:8px;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:600">${p.verdict}</span>
          </div>
          <div style="text-align:right;font-size:13px;font-weight:700;color:var(--accent)">Score: ${p.score}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;font-size:10px">
          <div style="background:var(--s2);padding:6px;border-radius:4px;text-align:center">
            <div style="color:var(--muted)">Bullish %</div>
            <div style="font-weight:700;color:#34d399">${p.bullRatio}%</div>
          </div>
          <div style="background:var(--s2);padding:6px;border-radius:4px;text-align:center">
            <div style="color:var(--muted)">Call Flow</div>
            <div style="font-weight:700">$${(p.callFlow/1000).toFixed(0)}K</div>
          </div>
          <div style="background:var(--s2);padding:6px;border-radius:4px;text-align:center">
            <div style="color:var(--muted)">Put Flow</div>
            <div style="font-weight:700">$${(p.putFlow/1000).toFixed(0)}K</div>
          </div>
          <div style="background:var(--s2);padding:6px;border-radius:4px;text-align:center">
            <div style="color:var(--muted)">Dark Pool</div>
            <div style="font-weight:700">$${(p.darkFlow/1000000).toFixed(1)}M</div>
          </div>
        </div>
        ${p.earningsIn ? `<div style="background:rgba(248,113,113,0.15);padding:6px;border-radius:4px;font-size:9px;color:#f87171;font-weight:600">⚠️ Earnings in ${p.earningsIn} days</div>` : ''}
      </div>
    `).join('');

    if (result.aiInsight) {
      document.getElementById('ai-agent-insight').textContent = result.aiInsight;
      document.getElementById('ai-agent-insight').style.display = 'block';
    }
  } catch(e) {
    el.innerHTML = `<div style="color:var(--red);padding:12px">${e.message}</div>`;
  }
}

// ── Dark Pool Tab ─────────────────────────────────────────────────────────────
async function loadDarkPool() {
  const el = document.getElementById('darkpool-list');
  el.innerHTML = `<div class="loading spin">Loading dark pool for ${activeTicker}</div>`;
  try {
    const trades = await fetch(`/api/darkpool/${activeTicker}`).then(r=>r.json());
    if (!trades.length) {
      el.innerHTML = `<div style="color:var(--muted);padding:20px;text-align:center">No dark pool data for ${activeTicker}</div>`;
      return;
    }
    const totalPremium = trades.reduce((s,t) => s + t.premium, 0);
    const bullish = trades.filter(t => t.sentiment === 'bullish').reduce((s,t) => s + t.premium, 0);
    const bullPct = totalPremium ? Math.round(bullish / totalPremium * 100) : 0;
    el.innerHTML = `
      <div style="background:rgba(122,61,237,0.1);border:1px solid #7c3aed33;border-radius:6px;padding:10px;margin-bottom:10px;font-size:11px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="color:var(--muted)">Total Dark Pool Volume</span>
          <span style="font-weight:700">$${(totalPremium/1000000).toFixed(2)}M</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--muted)">Bullish Sentiment</span>
          <span style="font-weight:700;color:${bullPct>50?'#34d399':'#f87171'}">${bullPct}%</span>
        </div>
      </div>
      ${trades.map(t => {
        const bull = t.sentiment === 'bullish';
        const prem = t.premium >= 1000000 ? `$${(t.premium/1000000).toFixed(2)}M` : `$${(t.premium/1000).toFixed(0)}K`;
        const age  = timeAgo(new Date(t.time));
        return `<div class="card" style="margin-bottom:6px">
          <div class="row">
            <div>
              <span style="font-size:12px;font-weight:700;color:${bull?'#34d399':'#f87171'}">${bull?'▲':'▼'} ${prem}</span>
              <span style="font-size:9px;color:var(--muted);margin-left:8px">${age}</span>
            </div>
            <span style="font-size:11px;color:var(--muted)">${t.size?.toLocaleString()} @ $${t.price?.toFixed(2)}</span>
          </div>
        </div>`;
      }).join('')}`;
  } catch(e) {
    el.innerHTML = `<div style="color:var(--red);padding:12px">${e.message}</div>`;
  }
}

// ── Intel Tab ─────────────────────────────────────────────────────────────────
async function loadIntel() {
  const [sectors, movers, wiki] = await Promise.allSettled([
    fetch('/api/sectors').then(r=>r.json()),
    fetch('/api/movers').then(r=>r.json()),
    fetch('/api/wikipedia-batch?tickers=' + getWatchlist().slice(0,10).join(',')).then(r=>r.json()),
  ]);

  // Sector heat map
  if (sectors.status === 'fulfilled') {
    document.getElementById('sector-list').innerHTML = sectors.value.map(s => {
      const up = s.change >= 0;
      const bar = Math.min(Math.abs(s.change) * 10, 100);
      const color = up ? '#34d399' : '#f87171';
      return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer" onclick="selectTicker('${s.symbol}')">
        <span style="font-size:10px;color:var(--muted);width:72px;flex-shrink:0">${s.sector}</span>
        <div style="flex:1;height:10px;background:var(--s2);border-radius:3px;overflow:hidden">
          <div style="width:${bar}%;height:100%;background:${color};opacity:.7"></div>
        </div>
        <span style="font-size:10px;font-weight:700;color:${color};width:42px;text-align:right">${up?'+':''}${s.change.toFixed(2)}%</span>
      </div>`;
    }).join('');
  }

  // Market movers
  if (movers.status === 'fulfilled') {
    const { gainers, losers, active } = movers.value;
    const row = (q, color) => `<div class="row" style="padding:3px 0;cursor:pointer" onclick="selectTicker('${q.symbol}')">
      <span style="font-size:11px;font-weight:700;color:var(--cyan)">${q.symbol}</span>
      <span style="font-size:10px;color:${color};font-weight:600">${q.change>=0?'+':''}${q.change?.toFixed(2)}%</span>
    </div>`;
    document.getElementById('movers-list').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:10px">
        <div>
          <div style="color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-size:9px">Top Gainers</div>
          ${(gainers||[]).map(q=>row(q,'#34d399')).join('')}
        </div>
        <div>
          <div style="color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-size:9px">Top Losers</div>
          ${(losers||[]).map(q=>row(q,'#f87171')).join('')}
        </div>
      </div>`;
  }

  // Wikipedia interest
  if (wiki.status === 'fulfilled' && Array.isArray(wiki.value) && wiki.value.length) {
    document.getElementById('wiki-list').innerHTML = wiki.value.map(w => {
      const up = (w.trend??0) >= 0;
      return `<div class="row" style="padding:5px 0;border-bottom:1px solid var(--border)">
        <span style="font-weight:600;font-size:12px;cursor:pointer;color:var(--cyan)" onclick="selectTicker('${w.ticker}')">${w.ticker}</span>
        <span style="font-size:10px;color:var(--muted)">${(w.avg??0).toLocaleString()}/day</span>
        <span style="font-size:12px;font-weight:700;color:${up?'#34d399':'#f87171'}">${up?'▲':'▼'}${Math.abs(w.trend??0)}%</span>
      </div>`;
    }).join('');
  } else {
    document.getElementById('wiki-list').innerHTML = '<div style="color:var(--muted);font-size:11px">No Wikipedia data</div>';
  }
}

// ── NEWS PAGE ─────────────────────────────────────────────────────────────────
async function loadNewsPage() {
  document.getElementById('news-grid').innerHTML = `<div class="loading spin" style="grid-column:1/-1">Loading market news</div>`;
  try {
    const news = await fetch('/api/news').then(r=>r.json());
    renderNewsGrid(news);
  } catch(e) {
    document.getElementById('news-grid').innerHTML = `<div style="color:var(--red);grid-column:1/-1;padding:20px">${e.message}</div>`;
  }
}
async function searchNews() {
  const q = document.getElementById('news-search').value.trim().toUpperCase();
  if (!q) return loadNewsPage();
  document.getElementById('news-grid').innerHTML = `<div class="loading spin" style="grid-column:1/-1">Searching ${q}</div>`;
  try {
    const news = await fetch(`/api/news/${q}`).then(r=>r.json());
    renderNewsGrid(news);
  } catch(e) {
    document.getElementById('news-grid').innerHTML = `<div style="color:var(--red);grid-column:1/-1;padding:20px">${e.message}</div>`;
  }
}
function renderNewsGrid(news) {
  if (!news.length) { document.getElementById('news-grid').innerHTML = '<div style="grid-column:1/-1;color:var(--muted);padding:20px;text-align:center">No news found</div>'; return; }
  document.getElementById('news-grid').innerHTML = news.map(n => {
    const age = timeAgo(new Date(n.publishedAt));
    return `<div class="ncard" onclick="window.open('${n.link}','_blank')">
      <div class="ncard-pub"><span>${n.publisher}</span><span>${age}</span></div>
      <div class="ncard-title">${n.title}</div>
      ${n.relatedTickers?.length ? `<div class="ncard-tickers">${n.relatedTickers.slice(0,5).map(t=>`<span class="ntick">${t}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
}

// ── SPOTLIGHT PICKS PAGE ──────────────────────────────────────────────────────
function getSpotlightPicks() {
  try { return JSON.parse(localStorage.getItem('of_spotlight')) || []; } catch { return []; }
}
function saveSpotlightPicks(picks) { localStorage.setItem('of_spotlight', JSON.stringify(picks)); }

function showAddPick() { document.getElementById('add-pick-modal').classList.add('open'); }
function closeAddPick() { document.getElementById('add-pick-modal').classList.remove('open'); }

function savePick() {
  const ticker  = document.getElementById('pk-ticker').value.trim().toUpperCase();
  const strike  = parseFloat(document.getElementById('pk-strike').value);
  const expiry  = document.getElementById('pk-expiry').value.trim();
  const cost    = parseFloat(document.getElementById('pk-cost').value);
  const prob    = parseFloat(document.getElementById('pk-prob').value);
  const signal  = document.getElementById('pk-signal').value.trim();
  if (!ticker || !strike || !expiry || !cost) { showToast('Fill in all required fields', 'err'); return; }

  const picks = getSpotlightPicks();
  picks.unshift({
    id: Date.now(), ticker, strike, expiry, cost,
    prob: prob || 0, signal: signal || 'Manual',
    addedAt: new Date().toISOString(),
    currentCost: null, status: 'open',
  });
  saveSpotlightPicks(picks);
  closeAddPick();
  loadSpotlightPage();
  showToast(`${ticker} $${strike}C added to Spotlight`, 'ok');
}

async function loadSpotlightPage() {
  const picks = getSpotlightPicks();

  // Stats
  const wins   = picks.filter(p => p.currentCost != null && p.currentCost > p.cost).length;
  const losses = picks.filter(p => p.currentCost != null && p.currentCost <= p.cost).length;
  const graded = wins + losses;
  const returns= picks.filter(p => p.currentCost != null).map(p => (p.currentCost - p.cost) / p.cost * 100);
  const avgRet = returns.length ? (returns.reduce((a,b)=>a+b,0)/returns.length).toFixed(1) : null;

  document.getElementById('stat-total').textContent = picks.length;
  document.getElementById('stat-wins').textContent  = wins;
  document.getElementById('stat-acc').textContent   = graded ? Math.round(wins/graded*100)+'%' : '—';
  document.getElementById('stat-avg').textContent   = avgRet != null ? (avgRet>=0?'+':'')+avgRet+'%' : '—';
  document.getElementById('stat-avg').className     = 'pstat-val ' + (avgRet>=0?'up':'dn');

  if (!picks.length) {
    document.getElementById('picks-body').innerHTML =
      `<div class="pick-add-form" style="grid-column:1/-1;padding:40px" onclick="showAddPick()">
        <div style="font-size:32px;margin-bottom:8px">+</div>
        <div style="font-weight:600">Add your first Spotlight Pick</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Track options calls day-over-day and measure accuracy</div>
      </div>`;
    return;
  }

  // Fetch current prices for open picks
  document.getElementById('picks-body').innerHTML = `<div class="loading spin" style="grid-column:1/-1">Fetching live prices</div>`;
  for (const pick of picks.filter(p=>p.status==='open')) {
    try {
      const q = await fetch(`/api/quote/${pick.ticker}`).then(r=>r.json());
      // Rough estimation: use current stock price vs strike to estimate option value change
      pick.currentStockPrice = q.price;
    } catch {}
  }

  const saved = getSpotlightPicks();
  document.getElementById('picks-body').innerHTML = picks.map((p,i) => {
    const pnl     = p.currentCost != null ? (p.currentCost - p.cost) / p.cost * 100 : null;
    const pnlDol  = p.currentCost != null ? ((p.currentCost - p.cost) * 100).toFixed(0) : null;
    const dte     = Math.max(0, Math.round((new Date(p.expiry) - Date.now()) / 86400000));
    const expired = dte === 0;
    const statusColor = expired ? '#f87171' : p.status==='open' ? '#34d399' : '#4b5563';

    return `<div class="pick-item">
      <div class="pi-top">
        <div>
          <span class="pi-sym" style="cursor:pointer;color:var(--cyan)" onclick="selectTicker('${p.ticker}');showPage('terminal',document.querySelector('.nav-link'))">${p.ticker}</span>
          <span style="font-size:12px;font-weight:600;margin-left:5px">$${p.strike}C</span>
        </div>
        <span class="pi-status" style="color:${statusColor}">${expired?'EXPIRED':p.status.toUpperCase()} · ${dte}d</span>
      </div>
      <div class="pi-contract">${p.expiry} · Added ${timeAgo(new Date(p.addedAt))}</div>
      <div class="pi-stats">
        <div class="pi-s"><div class="pi-s-val">$${p.cost}</div><div class="pi-s-lbl">Entry</div></div>
        <div class="pi-s"><div class="pi-s-val ${pnl!=null?pnl>=0?'up':'dn':''}">${p.currentCost!=null?'$'+p.currentCost:'—'}</div><div class="pi-s-lbl">Current</div></div>
        <div class="pi-s"><div class="pi-s-val ${pnl!=null?pnl>=0?'up':'dn':''}">${pnl!=null?(pnl>=0?'+':'')+pnl.toFixed(0)+'%':'—'}</div><div class="pi-s-lbl">P&L</div></div>
      </div>
      <div class="pi-bar">
        <div class="pi-fill" style="width:${Math.min(p.prob,100)}%;background:${p.prob>=40?'#34d399':p.prob>=20?'#fbbf24':'#4b5563'}"></div>
      </div>
      <div class="row" style="margin-top:6px">
        <span style="font-size:10px;color:var(--sub)">${p.prob}% entry prob · ${p.signal}</span>
        <button onclick="removeSpotlightPick(${i})" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:4px;padding:2px 7px;cursor:pointer;font-size:10px;">Remove</button>
      </div>
    </div>`;
  }).join('') +
  `<div class="pick-add-form" onclick="showAddPick()">
    <div style="font-size:24px">+</div>
    <div style="font-size:12px;font-weight:600">Add Spotlight Pick</div>
  </div>`;
}

function removeSpotlightPick(index) {
  const picks = getSpotlightPicks();
  picks.splice(index, 1);
  saveSpotlightPicks(picks);
  loadSpotlightPage();
}

// ── ParadoxAlgo Signals ────────────────────────────────────────────────────────
async function loadAlgoPage() {
  try {
    const [signals, stats] = await Promise.all([
      fetch('/api/algo/signals?limit=50').then(r => r.json()),
      fetch('/api/algo/stats').then(r => r.json()),
    ]);

    // Update stats
    document.getElementById('stat-total').textContent = stats.closed.toString();
    document.getElementById('stat-winrate').textContent = stats.winRate + '%';
    document.getElementById('stat-pnl').textContent = (stats.totalPnl >= 0 ? '+' : '') + stats.totalPnl.toFixed(2);
    document.getElementById('stat-avg').textContent = (stats.avgPnl >= 0 ? '+' : '') + stats.avgPnl.toFixed(2);

    // Render signals
    const list = document.getElementById('algo-signals-list');
    if (!signals.length) {
      list.innerHTML = '<div class="algo-empty">No signals yet. Configure ParadoxAlgo to POST to /api/algo/signal</div>';
      return;
    }

    list.innerHTML = signals.map(s => {
      const pnlColor = s.pnl === null ? '' : (s.pnl > 0 ? 'up' : 'dn');
      const pnlText = s.pnl === null ? '—' : (s.pnl > 0 ? '+' : '') + s.pnl.toFixed(2);
      return `
        <div class="algo-signal ${s.side} ${s.status === 'closed' && s.pnl > 0 ? 'win' : s.status === 'closed' && s.pnl < 0 ? 'loss' : ''}">
          <div class="sig-info">
            <div class="sig-sym">${s.symbol} <span style="font-size:11px;color:var(--sub);text-transform:uppercase;">${s.side}</span></div>
            <div class="sig-meta">Entry: $${s.entry.toFixed(2)} · ${s.reason} · ${(s.confidence).toFixed(0)}% conf</div>
            ${s.stop ? `<div class="sig-meta">Stop: $${s.stop.toFixed(2)} · Target: $${(s.target || '—').toString()}</div>` : ''}
          </div>
          <div class="sig-status">
            <span class="sig-badge ${s.status}">${s.status.toUpperCase()}</span>
            ${s.status !== 'pending' ? `<div class="sig-pnl ${pnlColor}">${pnlText}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch(e) {
    document.getElementById('algo-signals-list').innerHTML = '<div class="algo-empty">Error loading signals: ' + e.message + '</div>';
  }
}

// ── ACCOUNT PAGE ──────────────────────────────────────────────────────────────
async function loadAccountPage() {
  document.getElementById('acct-body').innerHTML = `<div class="loading spin" style="grid-column:1/-1">Loading accounts</div>`;
  try {
    const data = await fetch('/api/account').then(r=>r.json());
    let html = '';

    // Alpaca
    if (data.alpaca?.account) {
      const a   = data.alpaca.account;
      const pnl = parseFloat(a.equity||0) - parseFloat(a.last_equity||0);
      const up  = pnl >= 0;
      html += `<div class="acct-card">
        <div class="acct-card-title">Alpaca · Paper Trading</div>
        <div class="acct-row"><span class="acct-lbl">Portfolio Value</span><span class="acct-val">$${parseFloat(a.portfolio_value||0).toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
        <div class="acct-row"><span class="acct-lbl">Buying Power</span><span class="acct-val">$${parseFloat(a.buying_power||0).toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
        <div class="acct-row"><span class="acct-lbl">Today P&L</span><span class="acct-val ${up?'up':'dn'}">${up?'+':''}$${Math.abs(pnl).toFixed(2)}</span></div>
        <div class="acct-row"><span class="acct-lbl">Account #</span><span class="acct-val" style="color:var(--sub)">${a.account_number}</span></div>
      </div>`;

      // Positions
      if (data.alpaca.positions?.length) {
        html += `<div class="acct-card">
          <div class="acct-card-title">Open Positions</div>
          ${data.alpaca.positions.map(p=>{
            const pl = parseFloat(p.unrealized_pl||0);
            const plp= parseFloat(p.unrealized_plpc||0)*100;
            return `<div class="pos-row">
              <div><div class="pos-sym">${p.symbol}</div><div class="pos-qty">${p.qty} @ $${parseFloat(p.avg_entry_price).toFixed(2)}</div></div>
              <div class="row" style="gap:8px">
                <span style="font-size:11px;color:var(--sub)">$${parseFloat(p.current_price).toFixed(2)}</span>
                <span class="pos-pl ${pl>=0?'up':'dn'}">${pl>=0?'+':''}$${Math.abs(pl).toFixed(0)} (${pl>=0?'+':''}${plp.toFixed(1)}%)</span>
              </div>
            </div>`;
          }).join('')}
        </div>`;
      }
    }

    // Coinbase
    if (data.coinbase?.balances?.length) {
      html += `<div class="acct-card">
        <div class="acct-card-title">Coinbase · Crypto</div>
        ${data.coinbase.balances.map(b=>`<div class="acct-row">
          <span class="acct-lbl">${b.currency}</span>
          <span class="acct-val">${parseFloat(b.balance).toFixed(6)}</span>
        </div>`).join('')}
      </div>`;
    }

    // Broker connection status
    html += `<div class="acct-card">
      <div class="acct-card-title">Broker Connections</div>
      ${[
        { name:'Alpaca', id:'bp-alpaca', note:'Paper trading active' },
        { name:'Coinbase', id:'bp-coinbase', note:'Live crypto connected' },
        { name:'Tradier', id:'bp-tradier', note:'Awaiting approval' },
        { name:'Tradovate', id:'bp-tradovate', note:'Futures — pending' },
      ].map(b=>`<div class="conn-status">
        <div class="cdot ${document.getElementById(b.id)?.classList.contains('on')?'on':'off'}"></div>
        <span class="conn-name">${b.name}</span>
        <span class="conn-note">${b.note}</span>
      </div>`).join('')}
    </div>`;

    document.getElementById('acct-body').innerHTML = html || `<div class="loading" style="grid-column:1/-1">No account data available</div>`;
  } catch(e) {
    document.getElementById('acct-body').innerHTML = `<div style="color:var(--red);padding:20px;grid-column:1/-1">${e.message}</div>`;
  }
}

// ── Order Modal ────────────────────────────────────────────────────────────────
function openOrderModal(pick) {
  currentOrder = pick;
  activeBroker = 'alpaca';
  document.getElementById('m-title').textContent    = `Buy ${pick.ticker} $${pick.strike}C`;
  document.getElementById('m-sub').textContent      = pick.contract;
  document.getElementById('m-contract').textContent = pick.contract;
  document.getElementById('m-strike').textContent   = `$${pick.strike} · exp ${pick.expiry}`;
  document.getElementById('m-price').textContent    = `$${(pick.cost/100).toFixed(2)}/share ($${pick.cost}/contract)`;
  document.getElementById('m-qty').value            = '1';
  document.getElementById('m-limit').value          = (pick.cost/100).toFixed(2);
  document.getElementById('bc-alpaca').classList.add('sel');
  document.getElementById('bc-coinbase').classList.remove('sel');
  updateTotal();
  document.getElementById('order-modal').classList.add('open');
}
function closeModal() { document.getElementById('order-modal').classList.remove('open'); }
function selBroker(b) {
  activeBroker = b;
  document.querySelectorAll('.bchip').forEach(c=>c.classList.remove('sel'));
  document.getElementById('bc-'+b).classList.add('sel');
}
function updateTotal() {
  const qty = parseInt(document.getElementById('m-qty').value)||1;
  const lim = parseFloat(document.getElementById('m-limit').value)||0;
  document.getElementById('m-total').textContent = `Total: $${(qty*lim*100).toFixed(2)} · ${qty} contract${qty>1?'s':''}`;
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('m-qty')?.addEventListener('input', updateTotal);
  document.getElementById('m-limit')?.addEventListener('input', updateTotal);
  document.getElementById('order-modal')?.addEventListener('click', e => { if(e.target===e.currentTarget) closeModal(); });
  document.getElementById('add-pick-modal')?.addEventListener('click', e => { if(e.target===e.currentTarget) closeAddPick(); });
});
async function submitOrder() {
  if (!currentOrder) return;
  const qty   = parseInt(document.getElementById('m-qty').value)||1;
  const limit = parseFloat(document.getElementById('m-limit').value);
  const btn   = document.getElementById('m-confirm');
  btn.disabled=true; btn.textContent='Placing...';
  try {
    const data = await fetch('/api/order', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ broker:activeBroker, symbol:currentOrder.contract, side:'buy', qty, type:'limit', limitPrice:limit }),
    }).then(r=>r.json());
    if (data.success) { showToast(`✓ Order placed: ${qty}x ${currentOrder.contract}`, 'ok'); closeModal(); setTimeout(loadAccountPage,2000); }
    else showToast(`✗ ${data.error}`, 'err');
  } catch(e) { showToast(`✗ ${e.message}`, 'err'); }
  finally { btn.disabled=false; btn.textContent='Confirm Order →'; }
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg, type='ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `show ${type}`;
  setTimeout(() => el.className='', 4000);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function timeAgo(date) {
  const s = Math.floor((Date.now()-date)/1000);
  if (s<60)  return s+'s ago';
  if (s<3600)return Math.floor(s/60)+'m ago';
  if (s<86400)return Math.floor(s/3600)+'h ago';
  return Math.floor(s/86400)+'d ago';
}

// ── VIX loader ────────────────────────────────────────────────────────────────
async function loadVIX() {
  try {
    const vix = await fetch('/api/vix').then(r=>r.json());
    const price = vix.vix.price.toFixed(1);
    const color = vix.regime === 'high' ? '#f87171' : vix.regime === 'low' ? '#60a5fa' : '#fbbf24';
    const rankColor = vix.ivRankLabel === 'expensive' ? '#f87171' : vix.ivRankLabel === 'cheap' ? '#34d399' : '#fbbf24';
    document.getElementById('h-vix').innerHTML = `<span style="color:${color}">${price}</span><div style="font-size:9px;color:${rankColor};margin-top:2px">${vix.ivRankLabel}</div>`;
  } catch(e) { console.error('VIX load failed:', e.message); }
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  initChart();
  connectWS();
  renderTerminalPicks();
  loadAIAgent();
  loadTopPicks();
  loadStatus();
  loadCrypto();
  loadVIX();

  // Initial price fetch (before WS connects)
  fetch('/api/prices').then(r=>r.json()).then(d => {
    priceCache = d;
    renderWatchlist(d);
    updateHeader(d);
  });

  setInterval(loadCrypto,   15_000);
  setInterval(loadStatus,   30_000);
  setInterval(loadVIX,      30_000);
  setInterval(() => {
    if (document.querySelector('.pane.on#pane-ai-agent')) loadAIAgent();
  }, 300_000);
  populateExpiries(activeTicker);
});
