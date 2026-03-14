require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const NodeCache = require('node-cache');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const cache = new NodeCache({ stdTTL: 300 });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

function cacheGet(key) { return cache.get(key); }
function cacheSet(key, val) { cache.set(key, val); }

async function fetchYahooData(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`;
  const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
  return res.data;
}

async function fetchFundamentals(symbol) {
  const headers = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=financialData,defaultKeyStatistics,summaryDetail,assetProfile`;
    const res = await axios.get(url, { headers, timeout: 10000 });
    return res.data;
  } catch(e) {
    const url2 = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=financialData,defaultKeyStatistics,summaryDetail,assetProfile`;
    const res = await axios.get(url2, { headers, timeout: 10000 });
    return res.data;
  }
}

async function fetchKAPNews(symbol) {
  const results = [];
  const shortSymbol = symbol ? symbol.replace('.IS', '') : '';
  try {
    const kapUrl = 'https://www.kap.org.tr/tr/rss/bildirim';
    const res = await axios.get(kapUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000, responseType: 'text' });
    const xml = res.data;
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    for (const item of items.slice(0, 25)) {
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1] || '';
      const link = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
      if (title) results.push({ title, link, date: pubDate, company: shortSymbol });
    }
  } catch(e) {
    console.log('KAP hatasi:', e.message);
  }

  if (results.length === 0 && symbol) {
    try {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&newsCount=10&quotesCount=0`;
      const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
      const news = res.data?.news || [];
      for (const n of news) {
        results.push({ title: n.title, link: n.link, date: new Date(n.providerPublishTime * 1000).toISOString(), company: shortSymbol });
      }
    } catch(e) { console.log('Yahoo haber hatasi:', e.message); }
  }
  return results;
}

const SECTOR_BENCHMARKS = {
  'Bankacilik': { fk: 6.5, pddd: 0.85, roe: 13 },
  'Holding': { fk: 8.0, pddd: 0.6, roe: 10 },
  'Perakende': { fk: 12.0, pddd: 2.1, roe: 17 },
  'Enerji': { fk: 9.5, pddd: 1.2, roe: 12 },
  'Teknoloji': { fk: 18.0, pddd: 3.5, roe: 20 },
  'Insaat': { fk: 7.0, pddd: 1.0, roe: 14 },
  'Saglik': { fk: 14.0, pddd: 2.8, roe: 18 },
  'Gida': { fk: 10.0, pddd: 1.5, roe: 15 },
  'Genel': { fk: 10.0, pddd: 1.5, roe: 14 },
};

const MANUAL_FUNDAMENTALS = {
  'THYAO.IS': { sector: 'Ulasim', fk: 4.2, pddd: 1.8, roe: 42, ros: 18, beta: 1.2 },
  'GARAN.IS': { sector: 'Bankacilik', fk: 5.1, pddd: 0.9, roe: 18, ros: 22, beta: 1.1 },
  'AKBNK.IS': { sector: 'Bankacilik', fk: 4.8, pddd: 0.8, roe: 16, ros: 20, beta: 1.0 },
  'EREGL.IS': { sector: 'Metal', fk: 6.3, pddd: 1.1, roe: 17, ros: 14, beta: 0.9 },
  'ASELS.IS': { sector: 'Savunma', fk: 22.0, pddd: 4.2, roe: 19, ros: 12, beta: 0.8 },
  'KCHOL.IS': { sector: 'Holding', fk: 7.5, pddd: 0.7, roe: 9, ros: 8, beta: 1.0 },
  'BIMAS.IS': { sector: 'Perakende', fk: 14.0, pddd: 8.5, roe: 60, ros: 4, beta: 0.7 },
  'TCELL.IS': { sector: 'Teknoloji', fk: 9.2, pddd: 2.1, roe: 23, ros: 16, beta: 0.6 },
  'SISE.IS':  { sector: 'Holding', fk: 6.8, pddd: 0.9, roe: 13, ros: 11, beta: 1.1 },
  'PGSUS.IS': { sector: 'Ulasim', fk: 5.5, pddd: 2.2, roe: 40, ros: 15, beta: 1.3 },
};

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return Math.round(100 - (100 / (1 + avgGain / avgLoss)));
}

function calcSMA(closes, period) {
  if (closes.length < period) return null;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calcMACD(closes) {
  if (closes.length < 26) return { macd: null };
  return { macd: (calcEMA(closes, 12) - calcEMA(closes, 26)).toFixed(2) };
}

function calcBollingerBands(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period);
  return { upper: (sma + 2 * std).toFixed(2), middle: sma.toFixed(2), lower: (sma - 2 * std).toFixed(2) };
}

function calculateRating(fundamental, technical, sentiment) {
  let score = 0;
  const details = [];
  if (fundamental) {
    const { fk, pddd, roe, sector } = fundamental;
    const bench = SECTOR_BENCHMARKS[sector] || SECTOR_BENCHMARKS['Genel'];
    if (fk && fk > 0) {
      const s = fk < bench.fk * 0.7 ? 12 : fk < bench.fk ? 8 : fk < bench.fk * 1.5 ? 4 : 0;
      score += s;
      details.push({ label: 'F/K orani', score: s, max: 12, note: `${fk.toFixed(1)}x (sektor: ${bench.fk}x)` });
    }
    if (pddd && pddd > 0) {
      const s = pddd < bench.pddd * 0.6 ? 12 : pddd < bench.pddd ? 8 : pddd < bench.pddd * 1.5 ? 4 : 0;
      score += s;
      details.push({ label: 'PD/DD orani', score: s, max: 12, note: `${pddd.toFixed(2)}x (sektor: ${bench.pddd}x)` });
    }
    if (roe && roe > 0) {
      const s = roe > bench.roe * 1.3 ? 16 : roe > bench.roe ? 12 : roe > bench.roe * 0.7 ? 6 : 0;
      score += s;
      details.push({ label: 'ROE', score: s, max: 16, note: `${roe.toFixed(1)}% (sektor: ${bench.roe}%)` });
    }
  }
  if (technical) {
    const { rsi, trend } = technical;
    if (rsi != null) {
      const s = rsi >= 30 && rsi <= 70 ? 15 : rsi < 30 ? 12 : 5;
      score += s;
      details.push({ label: 'RSI', score: s, max: 15, note: `${rsi} (${rsi < 30 ? 'Asiri satim' : rsi > 70 ? 'Asiri alim' : 'Notr bolge'})` });
    }
    if (trend) {
      const s = trend === 'yukari' ? 20 : trend === 'yatay' ? 10 : 2;
      score += s;
      details.push({ label: 'Trend', score: s, max: 20, note: trend === 'yukari' ? 'Yukselen trend' : trend === 'yatay' ? 'Yatay seyir' : 'Dusen trend' });
    }
  }
  if (sentiment !== undefined) {
    const s = sentiment > 0.3 ? 25 : sentiment > 0 ? 18 : sentiment > -0.3 ? 10 : 2;
    score += s;
    details.push({ label: 'Haber sentimanti', score: s, max: 25, note: sentiment > 0.3 ? 'Pozitif haberler' : sentiment < -0.3 ? 'Negatif haberler' : 'Notr haberler' });
  }
  const grade = score >= 75 ? 'GUCLU AL' : score >= 55 ? 'AL' : score >= 35 ? 'BEKLE' : score >= 20 ? 'SAT' : 'GUCLU SAT';
  const color = score >= 75 ? '#22c55e' : score >= 55 ? '#86efac' : score >= 35 ? '#fbbf24' : score >= 20 ? '#f87171' : '#ef4444';
  return { score, grade, color, details, maxScore: 100 };
}

app.get('/api/stock/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = cacheGet(`stock_${symbol}`);
  if (cached) return res.json(cached);
  try {
    const data = await fetchYahooData(symbol);
    const chart = data.chart?.result?.[0];
    if (!chart) return res.status(404).json({ error: 'Hisse bulunamadi' });
    const closes = chart.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
    const timestamps = chart.timestamp || [];
    const volumes = chart.indicators?.quote?.[0]?.volume?.filter(v => v != null) || [];
    const currentPrice = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const change = currentPrice - prevClose;
    const changePercent = (change / prevClose) * 100;
    const sma20 = calcSMA(closes, 20), sma50 = calcSMA(closes, 50), sma200 = calcSMA(closes, 200);
    const rsi = calcRSI(closes), macd = calcMACD(closes), bb = calcBollingerBands(closes);
    let trend = 'yatay';
    if (sma20 && sma50 && currentPrice > sma20 && sma20 > sma50) trend = 'yukari';
    else if (sma20 && sma50 && currentPrice < sma20 && sma20 < sma50) trend = 'asagi';
    const result = {
      symbol, currentPrice: currentPrice?.toFixed(2), change: change?.toFixed(2),
      changePercent: changePercent?.toFixed(2), volume: volumes[volumes.length - 1],
      high52w: Math.max(...closes).toFixed(2), low52w: Math.min(...closes).toFixed(2),
      technical: { rsi, macd, sma20: sma20?.toFixed(2), sma50: sma50?.toFixed(2), sma200: sma200?.toFixed(2), bb, trend },
      chart: {
        dates: timestamps.slice(-60).map(t => new Date(t * 1000).toLocaleDateString('tr-TR')),
        closes: closes.slice(-60).map(v => v?.toFixed(2)),
        volumes: volumes.slice(-60),
      },
    };
    cacheSet(`stock_${symbol}`, result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/fundamentals/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = cacheGet(`fund_${symbol}`);
  if (cached) return res.json(cached);
  let result = null;
  try {
    const data = await fetchFundamentals(symbol);
    const summary = data.quoteSummary?.result?.[0];
    if (summary) {
      const fin = summary.financialData || {}, stats = summary.defaultKeyStatistics || {};
      const detail = summary.summaryDetail || {}, profile = summary.assetProfile || {};
      const price = detail.regularMarketPrice?.raw, eps = stats.trailingEps?.raw;
      result = {
        symbol, sector: profile.sector || MANUAL_FUNDAMENTALS[symbol]?.sector || 'Genel',
        industry: profile.industry || '',
        fk: detail.trailingPE?.raw || (price && eps ? price / eps : null),
        pddd: stats.priceToBook?.raw || null,
        roe: fin.returnOnEquity?.raw ? fin.returnOnEquity.raw * 100 : null,
        ros: fin.profitMargins?.raw ? fin.profitMargins.raw * 100 : null,
        eps: eps || null, marketCap: stats.marketCap?.raw || null,
        beta: stats.beta?.raw || null,
        dividendYield: detail.dividendYield?.raw ? detail.dividendYield.raw * 100 : null,
      };
    }
  } catch(e) { console.log('Yahoo fundamentals hatasi:', e.message); }

  if (!result || (!result.fk && !result.pddd && !result.roe)) {
    const manual = MANUAL_FUNDAMENTALS[symbol];
    result = manual ? { symbol, ...manual } : { symbol, sector: 'Genel', fk: null, pddd: null, roe: null };
  }
  cacheSet(`fund_${symbol}`, result);
  res.json(result);
});

app.get('/api/news', async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  const cacheKey = `news_${symbol || 'all'}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);
  try {
    let news = await fetchKAPNews(symbol);
    if (news.length > 0 && process.env.ANTHROPIC_API_KEY) {
      const titles = news.slice(0, 10).map(n => n.title).join('\n');
      try {
        const msg = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514', max_tokens: 600,
          messages: [{ role: 'user', content: `Haber basliklarini analiz et. Sadece JSON don: {"items":[{"sentiment":"olumlu"}],"overall":0.2}\n\n${titles}` }]
        });
        const raw = msg.content[0].text;
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          news = news.slice(0, 10).map((n, i) => ({ ...n, sentiment: parsed.items?.[i]?.sentiment || 'notr' }));
          const result = { news, overallSentiment: parsed.overall || 0 };
          cacheSet(cacheKey, result);
          return res.json(result);
        }
      } catch(e) { console.log('Sentimant hatasi:', e.message); }
    }
    const result = { news, overallSentiment: 0 };
    cacheSet(cacheKey, result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analyze/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = cacheGet(`analyze_${symbol}`);
  if (cached) return res.json(cached);
  const base = `http://localhost:${PORT}`;
  const [stockRes, fundRes, newsRes] = await Promise.allSettled([
    axios.get(`${base}/api/stock/${symbol}`),
    axios.get(`${base}/api/fundamentals/${symbol}`),
    axios.get(`${base}/api/news?symbol=${symbol}`),
  ]);
  const stock = stockRes.status === 'fulfilled' ? stockRes.value.data : null;
  const fund = fundRes.status === 'fulfilled' ? fundRes.value.data : null;
  const newsData = newsRes.status === 'fulfilled' ? newsRes.value.data : null;
  const fundamental = fund ? { fk: fund.fk, pddd: fund.pddd, roe: fund.roe, sector: fund.sector || 'Genel' } : null;
  const technical = stock ? { rsi: stock.technical?.rsi, trend: stock.technical?.trend } : null;
  const rating = calculateRating(fundamental, technical, newsData?.overallSentiment ?? 0);
  const bench = SECTOR_BENCHMARKS[fund?.sector] || SECTOR_BENCHMARKS['Genel'];
  const sectorComparison = fund ? {
    sector: fund.sector || 'Genel',
    fkVsSector: fund.fk ? ((fund.fk - bench.fk) / bench.fk * 100).toFixed(1) : null,
    pdddVsSector: fund.pddd ? ((fund.pddd - bench.pddd) / bench.pddd * 100).toFixed(1) : null,
    roeVsSector: fund.roe ? ((fund.roe - bench.roe) / bench.roe * 100).toFixed(1) : null,
  } : null;
  const result = { symbol, stock, fund, newsData, rating, sectorComparison };
  cacheSet(`analyze_${symbol}`, result);
  res.json(result);
});

app.post('/api/chat', async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: 'Mesaj gerekli' });
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 1000,
      system: `Sen uzman bir Turk borsa analisti ve finansal danismansin. BIST hisseleri, Turk ekonomisi ve global piyasalar hakkinda net, pratik ve analitik cevaplar ver. Teknik analiz (RSI, MACD, Bollinger Bands, MA), temel analiz (F/K, PD/DD, ROE) konularinda derinlemesine bilgi sahibisin. Risk uyarilarini unutma.${context ? `\n\nMevcut bagiam: ${JSON.stringify(context)}` : ''}`,
      messages: [{ role: 'user', content: message }],
    });
    res.json({ response: msg.content[0].text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/watchlist', async (req, res) => {
  const symbols = ['THYAO.IS', 'EREGL.IS', 'AKBNK.IS', 'GARAN.IS', 'ASELS.IS', 'KCHOL.IS', 'BIMAS.IS', 'TCELL.IS'];
  const cached = cacheGet('watchlist');
  if (cached) return res.json(cached);
  const results = await Promise.allSettled(symbols.map(s => axios.get(`http://localhost:${PORT}/api/stock/${s}`, { timeout: 8000 })));
  const data = results.filter(r => r.status === 'fulfilled').map(r => r.value.data);
  cacheSet('watchlist', data);
  res.json(data);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Borsa AI: http://localhost:${PORT}`));
