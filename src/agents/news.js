/**
 * News agent — two sources:
 *  1. NewsAPI (newsapi.org) if a valid key is configured
 *  2. Hacker News via Algolia API (free, no key) as primary fallback
 *
 * HN Algolia covers tech/startup/macro news well and has zero rate limits.
 */

import { config } from '../config.js';

const SENTIMENT_KEYWORDS = {
  bullish: ['beats', 'surges', 'jumps', 'rises', 'expands', 'wins', 'upgrades', 'raises guidance', 'record', 'breakthrough', 'launch', 'approved', 'partnership', 'deal'],
  bearish: ['misses', 'falls', 'drops', 'cuts', 'layoffs', 'recall', 'investigation', 'fine', 'lawsuit', 'downgrade', 'warns', 'delay', 'rejected', 'breach', 'scandal'],
};

function scoreSentiment(text) {
  const lower = text.toLowerCase();
  const bull = SENTIMENT_KEYWORDS.bullish.filter(w => lower.includes(w)).length;
  const bear = SENTIMENT_KEYWORDS.bearish.filter(w => lower.includes(w)).length;
  if (bull === bear) return { direction: 'neutral', score: 0 };
  return bull > bear ? { direction: 'bullish', score: bull - bear } : { direction: 'bearish', score: bear - bull };
}

function processArticles(articles, tickers = []) {
  return articles.map(a => {
    const fullText = `${a.title ?? ''} ${a.description ?? a.story_text ?? ''}`;
    const sentiment = scoreSentiment(fullText);
    const mentionedTickers = tickers.filter(t => fullText.toUpperCase().includes(t));
    return {
      title: a.title,
      source: a.source?.name ?? a.author ?? 'HackerNews',
      publishedAt: a.publishedAt ?? a.created_at,
      url: a.url,
      sentiment: sentiment.direction,
      sentimentScore: sentiment.score,
      mentionedTickers,
    };
  });
}

async function fetchHackerNews(query, limit = 20) {
  const params = new URLSearchParams({
    query,
    tags: 'story',
    numericFilters: `created_at_i>${Math.floor((Date.now() - 86_400_000) / 1000)}`,
    hitsPerPage: String(limit),
  });
  const res = await fetch(`https://hn.algolia.com/api/v1/search?${params}`);
  if (!res.ok) throw new Error(`HN Algolia error: ${res.status}`);
  const { hits } = await res.json();
  return hits.map(h => ({
    title: h.title,
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
    author: h.author,
    created_at: h.created_at,
    points: h.points,
  }));
}

async function fetchNewsAPI(query, tickers, daysBack, apiKey) {
  const fromDate = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
  const tickerQuery = tickers.length ? ` OR ${tickers.join(' OR ')}` : '';
  const params = new URLSearchParams({
    q: query + tickerQuery,
    from: fromDate,
    sortBy: 'publishedAt',
    pageSize: '30',
    language: 'en',
    apiKey,
  });
  const res = await fetch(`${config.news.baseUrl}/everything?${params}`);
  const data = await res.json();
  if (data.status !== 'ok') throw new Error(`NewsAPI: ${data.message}`);
  return data.articles ?? [];
}

export async function fetchNewsSignals({ query = 'stock market finance earnings', tickers = [], daysBack = 1 } = {}) {
  let articles = [];
  let newsSource = 'hacker_news';

  // Try NewsAPI first if key is configured
  if (config.news.apiKey) {
    try {
      const raw = await fetchNewsAPI(query, tickers, daysBack, config.news.apiKey);
      articles = raw;
      newsSource = 'newsapi';
    } catch (e) {
      // Fall through to HN
    }
  }

  // HackerNews fallback (always runs if NewsAPI failed or unconfigured)
  if (!articles.length) {
    const hnQuery = tickers.length ? tickers.slice(0, 3).join(' OR ') + ' ' + query : query;
    articles = await fetchHackerNews(hnQuery, 25);
    newsSource = 'hacker_news';
  }

  const processed = processArticles(articles, tickers);

  const tickerSentiment = tickers.reduce((acc, ticker) => {
    const relevant = processed.filter(a => a.mentionedTickers.includes(ticker));
    if (!relevant.length) return acc;
    const bullish = relevant.filter(a => a.sentiment === 'bullish').length;
    const bearish = relevant.filter(a => a.sentiment === 'bearish').length;
    acc[ticker] = {
      articleCount: relevant.length,
      bullish, bearish,
      netSentiment: bullish - bearish,
      direction: bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'neutral',
    };
    return acc;
  }, {});

  return {
    source: newsSource,
    articleCount: processed.length,
    articles: processed,
    tickerSentiment,
    fetchedAt: new Date().toISOString(),
  };
}
