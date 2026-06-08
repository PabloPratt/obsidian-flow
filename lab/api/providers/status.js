const { providerStatus } = require("../_shared");

module.exports = function handler(req, res) {
  res.status(200).json(providerStatus());
};
