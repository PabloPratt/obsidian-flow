/**
 * Performance Tracker — tracks all trades, calculates metrics, identifies patterns
 */

export function calculateMetrics(trades) {
  const closed = trades.filter(t => t.status === 'closed');
  if (!closed.length) return null;

  const wins = closed.filter(t => t.pnl > 0);
  const losses = closed.filter(t => t.pnl < 0);
  const breakevens = closed.filter(t => t.pnl === 0);

  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const profitFactor = Math.abs(avgLoss) > 0 ? Math.abs(avgWin / avgLoss) : 0;

  const winRate = (wins.length / closed.length * 100).toFixed(1);
  const expectancy = (avgWin * (wins.length / closed.length)) + (avgLoss * (losses.length / closed.length));

  // Sharpe ratio (assuming daily trades, 252 trading days/year)
  const returns = closed.map(t => t.pnlPct || 0);
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

  // Drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let runningPnl = 0;
  for (const t of closed) {
    runningPnl += t.pnl;
    peak = Math.max(peak, runningPnl);
    maxDrawdown = Math.min(maxDrawdown, runningPnl - peak);
  }

  return {
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    winRate: parseFloat(winRate),
    profitFactor: profitFactor.toFixed(2),
    expectancy: expectancy.toFixed(2),
    totalPnl: totalPnl.toFixed(2),
    avgWin: avgWin.toFixed(2),
    avgLoss: avgLoss.toFixed(2),
    sharpe: sharpe.toFixed(2),
    maxDrawdown: maxDrawdown.toFixed(2),
    roi: totalPnl > 0 ? ((totalPnl / closed.length) * 100).toFixed(1) : '0',
  };
}

export function identifyPatterns(trades) {
  const patterns = {
    bestTimeOfDay: null,
    bestDayOfWeek: null,
    bestSymbol: null,
    bestSignal: null,
    winningStreakMax: 0,
    losingStreakMax: 0,
  };

  // By signal type
  const bySignal = {};
  for (const t of trades.filter(t => t.status === 'closed')) {
    const sig = t.signal || 'unknown';
    if (!bySignal[sig]) bySignal[sig] = [];
    bySignal[sig].push(t);
  }

  // Find best signal
  let bestWinRate = 0;
  for (const [sig, trades] of Object.entries(bySignal)) {
    const wr = trades.filter(t => t.pnl > 0).length / trades.length;
    if (wr > bestWinRate) {
      bestWinRate = wr;
      patterns.bestSignal = sig;
    }
  }

  // Winning streaks
  let currentWinStreak = 0;
  let currentLoseStreak = 0;
  for (const t of trades.filter(t => t.status === 'closed')) {
    if (t.pnl > 0) {
      currentWinStreak++;
      patterns.winningStreakMax = Math.max(patterns.winningStreakMax, currentWinStreak);
      currentLoseStreak = 0;
    } else {
      currentLoseStreak++;
      patterns.losingStreakMax = Math.max(patterns.losingStreakMax, currentLoseStreak);
      currentWinStreak = 0;
    }
  }

  return patterns;
}

export function recommendAdjustments(metrics, patterns) {
  const recommendations = [];

  if (parseFloat(metrics.winRate) < 50) {
    recommendations.push('Win rate below 50% - review entry signals');
  }

  if (parseFloat(metrics.profitFactor) < 1.5) {
    recommendations.push('Profit factor below 1.5 - widen stops or tighten entries');
  }

  if (Math.abs(parseFloat(metrics.maxDrawdown)) > 500) {
    recommendations.push('Max drawdown excessive - reduce position size');
  }

  if (patterns.losingStreakMax > 5) {
    recommendations.push('Losing streak detected - consider market break');
  }

  if (patterns.bestSignal) {
    recommendations.push(`Focus on ${patterns.bestSignal} signals - highest win rate`);
  }

  return recommendations;
}
