/**
 * Risk Manager Agent — autonomous position sizing and risk control
 * Calculates Kelly Criterion sizing, stop losses, and max drawdown limits
 */

export function calculatePositionSize(
  accountBalance,
  riskPercentage = 2, // Risk 2% per trade
  winRate = 0.6,     // Historical win rate
  avgWin = 1.5,      // Avg win/loss ratio
  optionPrice
) {
  // Kelly Criterion: f = (p*b - q) / b
  // where p = win prob, q = loss prob, b = win/loss ratio
  const p = winRate;
  const q = 1 - winRate;
  const b = avgWin;
  const kellyFraction = (p * b - q) / b;

  // Conservative: use 25% of Kelly
  const conservativeFraction = Math.max(0, Math.min(0.25 * kellyFraction, 0.05)); // Cap at 5%

  // Dollar amount to risk
  const riskAmount = (accountBalance * (riskPercentage / 100));

  // Contracts to buy (each contract = $100 * option price)
  const contractValue = optionPrice * 100;
  const maxContracts = Math.floor(riskAmount / contractValue);

  return {
    riskAmount,
    maxContracts: Math.max(1, maxContracts),
    conservativeSize: Math.max(1, Math.floor(maxContracts * conservativeFraction)),
    kellySize: Math.max(1, Math.floor(maxContracts * kellyFraction)),
  };
}

export function calculateStopLoss(entryPrice, riskPercentage = 2) {
  return entryPrice * (1 - riskPercentage / 100);
}

export function calculateTakeProfit(entryPrice, rewardPercentage = 3) {
  return entryPrice * (1 + rewardPercentage / 100);
}

export function calculateMaxDrawdown(balance, maxLossPerTrade = 0.02) {
  // After losing max allowed per trade N times in a row, what's the portfolio hit?
  // This helps determine when to stop trading and reassess
  const daysToRecovery = {};
  for (let n = 1; n <= 10; n++) {
    const drawdown = Math.pow(1 - maxLossPerTrade, n);
    daysToRecovery[n] = Math.round(n / (maxLossPerTrade * 252) * 365); // Trading days
  }
  return daysToRecovery;
}

// Risk rules for execution
export function validateTrade(trade, account) {
  const issues = [];

  // Rule 1: Max single trade risk
  if (trade.riskAmount > account.balance * 0.05) {
    issues.push('Single trade risk exceeds 5% of account');
  }

  // Rule 2: Portfolio heat (current open risk)
  const currentRisk = account.openTrades?.reduce((sum, t) => sum + t.risk, 0) || 0;
  if (currentRisk + trade.riskAmount > account.balance * 0.15) {
    issues.push('Total portfolio risk would exceed 15%');
  }

  // Rule 3: Probability filter
  if (trade.probability < 0.55) {
    issues.push('Probability below 55% minimum');
  }

  // Rule 4: Liquidity check
  if (!trade.volume || trade.volume < 100) {
    issues.push('Insufficient volume (< 100 contracts)');
  }

  return {
    approved: issues.length === 0,
    issues,
    severity: issues.length > 0 ? 'warning' : 'ok',
  };
}
