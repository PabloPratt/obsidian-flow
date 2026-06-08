const { optionsScan } = require("../_shared");

module.exports = async function handler(req, res) {
  const rawTickers = typeof req.query.tickers === "string" ? req.query.tickers : "SPY,QQQ,NVDA,AMD,AAPL,TSLA";
  const tickers = rawTickers
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 12);

  res.status(200).json(await optionsScan(tickers));
};
