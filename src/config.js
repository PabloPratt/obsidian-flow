import 'dotenv/config';

export const config = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-opus-4-8',
  },
  polygon: {
    apiKey: process.env.POLYGON_API_KEY,
    baseUrl: 'https://api.polygon.io',
  },
  alpaca: {
    apiKey: process.env.ALPACA_API_KEY,
    secretKey: process.env.ALPACA_SECRET_KEY,
    baseUrl: process.env.ALPACA_BASE_URL ?? 'https://paper-api.alpaca.markets',
  },
  unusualWhales: {
    apiKey: process.env.UNUSUAL_WHALES_API_KEY,
    baseUrl: 'https://api.unusualwhales.com/api',
  },
  nasa: {
    apiKey: process.env.NASA_API_KEY ?? 'DEMO_KEY',
    eonetUrl: 'https://eonet.gsfc.nasa.gov/api/v3',
  },
  ais: {
    apiKey: process.env.MARINETRAFFIC_API_KEY,
    baseUrl: 'https://services.marinetraffic.com/api',
  },
  opensky: {
    username: process.env.OPENSKY_USERNAME,
    password: process.env.OPENSKY_PASSWORD,
    baseUrl: 'https://opensky-network.org/api',
  },
  news: {
    apiKey: process.env.NEWS_API_KEY,
    baseUrl: 'https://newsapi.org/v2',
  },
  fred: {
    apiKey: process.env.FRED_API_KEY,
  },
  eia: {
    apiKey: process.env.EIA_API_KEY,
  },
  fda: {
    apiKey: process.env.FDA_API_KEY, // optional — raises rate limit from 1k to 120k/day
  },
};
