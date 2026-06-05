/**
 * Market Intelligence Agent — autonomous multi-signal scanner
 * Runs on demand or on schedule, synthesizes data from all sources,
 * produces ranked trade opportunities with AI conviction scores.
 */

const UW_BASE  = 'https://api.unusualwhales.com/api';
const UW_TOKEN = () => process.env.UNUSUAL_WHALES_API_KEY;
const AI_KEY   = () => process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

async function uw(path) {
  const res = await fetch(`${UW_BASE}${path}`, {
    headers: { Authorization: `Bearer ${UW_TOKEN()}` },
  });
  if (!res.ok) throw new Error(`UW ${path} → ${res.status}`);
  const json = await res.json();
  return json.data ?? json;
}

// Pull top signals from all sources in parallel
async function gatherSignals() {
  const [flow, darkpool, greeks, earnings] = await Promise.allSettled([
    uw('/option-trades/flow-alerts?limit=100&min_premium=100000'),
    uw('/darkpool/recent?limit=50'),
    uw('/market/greek-flow?limit=50'),
    uw('/earnings/upcoming?limit=20'),
  ]);

  return {
    flow:     flow.status     === 'fulfilled' ? flow.value     : [],
    darkpool: darkpool.status === 'fulfilled' ? darkpool.value : [],
    greeks:   greeks.status   === 'fulfilled' ? greeks.value   : [],
    earnings: earnings.status === 'fulfilled' ? earnings.value : [],
  };
}

// Aggregate smart money positioning per ticker
function aggregateByTicker(signals) {
  const map = {};

  for (const alert of signals.flow) {
    const t = alert.ticker;
    if (!t || t.includes(' ')) continue;
    if (!map[t]) map[t] = { ticker: t, callFlow: 0, putFlow: 0, darkFlow: 0, dteAlerts: [], signals: [] };
    const premium = parseInt(alert.total_premium ?? 0);
    if (alert.type === 'call') map[t].callFlow += premium;
    else map[t].putFlow += premium;
    map[t].signals.push({ type: 'flow', signal: alert.alert_rule, premium, side: alert.type });
  }

  for (const trade of signals.darkpool) {
    const t = trade.ticker;
    if (!t || !map[t]) continue;
    map[t].darkFlow += parseFloat(trade.price ?? 0) * parseInt(trade.size ?? 0);
    map[t].signals.push({ type: 'darkpool', size: trade.size, price: trade.price });
  }

  for (const e of signals.earnings) {
    const t = e.ticker;
    if (!t || !map[t]) continue;
    const dte = Math.ceil((new Date(e.date) - Date.now()) / 86400000);
    if (dte > 0 && dte <= 14) {
      map[t].earningsIn = dte;
      map[t].signals.push({ type: 'earnings', daysTo: dte });
    }
  }

  return Object.values(map);
}

// Score each ticker: higher = more conviction
function scoreOpportunities(tickers) {
  return tickers.map(t => {
    const netBull  = t.callFlow - t.putFlow;
    const bullRatio = t.callFlow / (t.callFlow + t.putFlow + 1);
    const darkBoost = t.darkFlow > 500000 ? 1.2 : 1.0;
    const earningsBoost = t.earningsIn ? 1.3 : 1.0;
    const score = Math.round(netBull / 1000 * bullRatio * darkBoost * earningsBoost);

    return {
      ...t,
      score,
      bullRatio: Math.round(bullRatio * 100),
      verdict: bullRatio > 0.7 ? 'STRONG BUY' : bullRatio > 0.55 ? 'BUY' : bullRatio > 0.45 ? 'NEUTRAL' : 'SKIP',
    };
  })
  .filter(t => t.verdict !== 'SKIP' && t.callFlow > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 8);
}

// Optional: send top picks to Claude for plain-English synthesis
async function synthesizeWithAI(picks) {
  const key = AI_KEY();
  if (!key || !picks.length) return null;

  const prompt = `You are a professional trader scanning for options plays. Here are the top smart money signals detected right now:

${picks.slice(0, 5).map(p =>
  `${p.ticker}: ${p.verdict} — ${p.bullRatio}% bullish, $${(p.callFlow/1000).toFixed(0)}K calls vs $${(p.putFlow/1000).toFixed(0)}K puts${p.earningsIn ? `, earnings in ${p.earningsIn}d` : ''}`
).join('\n')}

Give a 1-sentence insight for EACH ticker in the format: "TICKER: [plain English explanation of why smart money is moving]"
Be direct. No fluff. Total response under 200 words.`;

  try {
    const isAnthropic = key.startsWith('sk-ant');
    const url = isAnthropic ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/chat/completions';
    const headers = isAnthropic
      ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
      : { Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
    const body = isAnthropic
      ? JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 250, messages: [{ role: 'user', content: prompt }] })
      : JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 250, messages: [{ role: 'user', content: prompt }] });

    const res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok) return null;
    const data = await res.json();
    return isAnthropic ? data.content[0].text : data.choices[0].message.content;
  } catch {
    return null;
  }
}

// Main agent entry point
export async function runMarketIntelligence() {
  const signals  = await gatherSignals();
  const tickers  = aggregateByTicker(signals);
  const picks    = scoreOpportunities(tickers);
  const aiInsight = await synthesizeWithAI(picks);

  return {
    picks,
    aiInsight,
    signalCount: signals.flow.length + signals.darkpool.length,
    generatedAt: new Date().toISOString(),
  };
}
