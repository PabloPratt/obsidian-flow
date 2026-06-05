/**
 * Execution Agent — autonomous order placement with risk validation
 * Checks Kelly sizing, portfolio heat, probability filters before executing
 */

import { calculatePositionSize, validateTrade } from './risk-manager.js';

export async function executeOptionsTrade(trade, account, broker = 'alpaca') {
  // Step 1: Risk validation
  const validation = validateTrade(trade, account);
  if (!validation.approved) {
    return {
      success: false,
      reason: `Validation failed: ${validation.issues.join('; ')}`,
      trade,
    };
  }

  // Step 2: Calculate position size (Kelly Criterion)
  const historicalWinRate = account.winRate || 0.58;
  const historicalAvgWin = account.profitFactor || 1.3;
  const sizing = calculatePositionSize(
    account.balance,
    2, // Risk 2% per trade
    historicalWinRate,
    historicalAvgWin,
    trade.ask
  );

  const contracts = sizing.conservativeSize;
  const totalCost = contracts * (trade.ask * 100);

  // Step 3: Place order
  try {
    const order = {
      symbol: trade.ticker,
      qty: contracts,
      side: 'buy',
      type: 'limit',
      limitPrice: trade.ask,
      optionSymbol: trade.optionSymbol,
      stopPrice: trade.stopLoss,
      targetPrice: trade.targetPrice,
      confidence: trade.probability,
      reason: trade.smartMoneySignal,
    };

    // Log for audit trail
    console.log(`[EXEC] ${contracts} ${trade.ticker} @ $${trade.ask} | Risk: $${sizing.riskAmount} | Prob: ${trade.probability}%`);

    // TODO: Call broker API here
    // const result = await alpaca.placeOrder(order);

    return {
      success: true,
      orderId: `ORD-${Date.now()}`,
      order,
      sizing,
      contracts,
      totalCost,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return {
      success: false,
      reason: e.message,
      trade,
    };
  }
}

// Batch execution for multiple signals
export async function executeBatch(signals, account) {
  const executed = [];
  const rejected = [];

  for (const signal of signals) {
    const result = await executeOptionsTrade(signal, account);
    if (result.success) {
      executed.push(result);
      account.balance -= result.totalCost; // Update balance
    } else {
      rejected.push(result);
    }
  }

  return { executed, rejected, accountBalance: account.balance };
}

// Auto-scale position sizes based on recent performance
export function autoScaleSize(historicalMetrics) {
  const { winRate, maxDrawdown, daysInDrawdown } = historicalMetrics;

  // If in drawdown, reduce size by 50%
  if (daysInDrawdown > 0 && daysInDrawdown <= 7) {
    return 0.5;
  }

  // If winning streak, increase by 25%
  if (winRate > 0.65) {
    return 1.25;
  }

  // Normal mode
  return 1.0;
}
