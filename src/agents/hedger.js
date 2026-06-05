/**
 * Hedger Agent — automatic protective puts when portfolio heat increases
 */

export function calculateHedgeNeeded(portfolio) {
  const { totalValue, unrealizedPnl, openPositions } = portfolio;

  // If down 5% or more, hedge 25% of exposure
  const downPercentage = Math.abs(unrealizedPnl / totalValue);

  if (downPercentage >= 0.05) {
    return {
      shouldHedge: true,
      hedgeRatio: 0.25,
      reason: `Portfolio down ${(downPercentage * 100).toFixed(1)}%`,
    };
  }

  // If 10+ open positions, hedge 10% of exposure
  if (openPositions >= 10) {
    return {
      shouldHedge: true,
      hedgeRatio: 0.1,
      reason: `${openPositions} open positions - high correlation risk`,
    };
  }

  // If max single position > 30% of account, hedge it
  const largestPosition = Math.max(...openPositions.map(p => p.size));
  if (largestPosition > totalValue * 0.3) {
    return {
      shouldHedge: true,
      hedgeRatio: 0.5,
      reason: `Single position ${(largestPosition / totalValue * 100).toFixed(0)}% of account - over-concentrated`,
    };
  }

  return { shouldHedge: false };
}

// Calculate protective put strike
export function getProtectivePutStrike(stockPrice, protectionLevel = 0.05) {
  // Buy puts 5% below current price
  return (stockPrice * (1 - protectionLevel)).toFixed(2);
}

// Cost of hedge vs potential protection
export function hedgeAnalysis(position, putCost) {
  const hedgeCostPercent = (putCost / position.marketValue * 100).toFixed(1);
  const maxLossWithoutHedge = position.marketValue;
  const maxLossWithHedge = putCost;
  const breakeven = position.entryPrice + putCost;

  return {
    hedgeCostPercent,
    maxLossWithoutHedge,
    maxLossWithHedge,
    breakeven,
    worthIt: hedgeCostPercent < 2, // Hedge if < 2% cost
  };
}

// Portfolio-level hedge recommendation
export function recommendPortfolioHedge(portfolio) {
  const hedgeNeeded = calculateHedgeNeeded(portfolio);

  if (!hedgeNeeded.shouldHedge) {
    return { action: 'none', reason: 'Portfolio within safe parameters' };
  }

  // Recommend buying SPY puts or VIX calls
  return {
    action: 'buy_protective_puts',
    instrument: 'SPY',
    ratio: hedgeNeeded.hedgeRatio,
    reason: hedgeNeeded.reason,
    expectedCost: (portfolio.totalValue * hedgeNeeded.hedgeRatio * 0.02).toFixed(2), // ~2% cost
  };
}
