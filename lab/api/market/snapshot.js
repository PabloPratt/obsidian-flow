const { getCoinbaseTicker, getYahooQuotes, providerStatus } = require("../_shared");

module.exports = async function handler(req, res) {
  const fallback = [
    { symbol: "SPY", price: 629.14, change: 0.42, source: "demo" },
    { symbol: "QQQ", price: 554.83, change: 0.68, source: "demo" },
    { symbol: "IWM", price: 218.36, change: -0.21, source: "demo" },
    { symbol: "VIX", price: 14.22, change: -0.74, source: "demo" },
  ];

  const settled = await Promise.allSettled([
    getYahooQuotes(["SPY", "QQQ", "IWM", "^VIX"]),
    getCoinbaseTicker("BTC-USD"),
  ]);

  const yahoo = settled[0].status === "fulfilled" ? settled[0].value : [];
  const coinbase = settled[1].status === "fulfilled" ? [settled[1].value] : [];
  const live = [...yahoo, ...coinbase].filter((item) => Number.isFinite(item.price));

  res.status(200).json({
    live: live.length > 0,
    items: live.length > 0 ? live : fallback,
    providers: {
      ...providerStatus(),
      yahoo: settled[0].status === "fulfilled" ? "connected" : "unavailable",
      coinbase: settled[1].status === "fulfilled" ? "connected" : "unavailable",
    },
  });
};
