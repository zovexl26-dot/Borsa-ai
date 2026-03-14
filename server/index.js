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

// Guncel BIST temel verileri (Mart 2026)
const FUNDAMENTALS_DB = {
  'THYAO.IS': { sector: 'Ulasim', industry: 'Havayollari', fk: 4.2, pddd: 1.8, roe: 42, ros: 18, beta: 1.2, marketCap: 185000000000, dividendYield: 0, employees: 28000 },
  'GARAN.IS': { sector: 'Bankacilik', industry: 'Bankalar', fk: 5.1, pddd: 0.9, roe: 18, ros: 22, beta: 1.1, marketCap: 220000000000, dividendYield: 3.2, employees: 21000 },
  'AKBNK.IS': { sector: 'Bankacilik', industry: 'Bankalar', fk: 4.8, pddd: 0.8, roe: 16, ros: 20, beta: 1.0, marketCap: 195000000000, dividendYield: 2.8, employees: 13000 },
  'EREGL.IS': { sector: 'Metal', industry: 'Demir Celik', fk: 6.3, pddd: 1.1, roe: 17, ros: 14, beta: 0.9, marketCap: 140000000000, dividendYield: 8.5, employees: 11000 },
  'ASELS.IS': { sector: 'Savunma', industry: 'Savunma Sanayi', fk: 22.0, pddd: 4.2, roe: 19, ros: 12, beta: 0.8, marketCap: 320000000000, dividendYield: 0, employees: 7500 },
  'KCHOL.IS': { sector: 'Holding', industry: 'Holding', fk: 7.5, pddd: 0.7, roe: 9, ros: 8, beta: 1.0, marketCap: 410000000000, dividendYield: 1.5, employees: 90000 },
  'BIMAS.IS': { sector: 'Perakende', industry: 'Gida Perakende', fk: 14.0, pddd: 8.5, roe: 60, ros: 4, beta: 0.7, marketCap: 210000000000, dividendYield: 2.1, employees: 45000 },
  'TCELL.IS': { sector: 'Teknoloji', industry: 'Telekomunikasyon', fk: 9.2, pddd: 2.1, roe: 23, ros: 16, beta: 0.6, marketCap: 175000000000, dividendYield: 4.5, employees: 12000 },
  'SISE.IS':  { sector: 'Holding', industry: 'Holding', fk: 6.8, pddd: 0.9, roe: 13, ros: 11, beta: 1.1, marketCap: 130000000000, dividendYield: 2.0, employees: 55000 },
  'PGSUS.IS': { sector: 'Ulasim', industry: 'Havayollari', fk: 5.5, pddd: 2.2, roe: 40, ros: 15, beta: 1.3, marketCap: 45000000000, dividendYield: 0, employees: 5000 },
  'ISCTR.IS': { sector: 'Bankacilik', industry: 'Bankalar', fk: 4.5, pddd: 0.85, roe: 19, ros: 21, beta: 1.1, marketCap: 210000000000, dividendYield: 3.0, employees: 25000 },
  'TOASO.IS': { sector: 'Otomotiv', industry: 'Otomotiv', fk: 8.2, pddd: 2.8, roe: 34, ros: 12, beta: 1.0, marketCap: 95000000000, dividendYield: 5.2, employees: 8000 },
  'FROTO.IS': { sector: 'Otomotiv', industry: 'Otomotiv', fk: 9.5, pddd: 3.1, roe: 32, ros: 11, beta: 0.9, marketCap: 180000000000, dividendYield: 4.8, employees: 15000 },
  'ARCLK.IS': { sector: 'Teknoloji', industry: 'Beyaz Esya', fk: 11.0, pddd: 1.9, roe: 17, ros: 8, beta: 1.2, marketCap: 85000000000, dividendYield: 1.8, employees: 40000 },
  'TUPRS.IS': { sector: 'Enerji', industry: 'Rafinerier', fk: 7.8, pddd: 1.4, roe: 18, ros: 5, beta: 0.8, marketCap: 115000000000, dividendYield: 6.5, employees: 4500 },
  'SAHOL.IS': { sector: 'Holding', industry: 'Holding', fk: 6.2, pddd: 0.65, roe: 10, ros: 9, beta: 0.9, marketCap: 290000000000, dividendYield: 1.2, employees: 70000 },
  'HALKB.IS': { sector: 'Bankacilik', industry: 'Bankalar', fk: 3.8, pddd: 0.55, roe: 14, ros: 18, beta: 1.3, marketCap: 95000000000, dividendYield: 0, employees: 18000 },
  'VAKBN.IS': { sector: 'Bankacilik', industry: 'Bankalar', fk: 4.1, pddd: 0.6, roe: 15, ros: 19, beta: 1.2, marketCap: 110000000000, dividendYield: 2.5, employees: 16000 },
};

const SECTOR_BENCHMARKS = {
  'Bankacilik': { fk: 5.5, pddd: 0.8, roe: 16 },
  'Holding': { fk: 7.5, pddd: 0.7, roe: 10 },
  'Perakende': { fk: 13.0, pddd: 4.0, roe: 35 },
  'Enerji': { fk: 8.5, pddd: 1.3, roe: 16 },
  'Teknoloji': { fk: 12.0, pddd: 2.5, roe: 20 },
  'Otomotiv': { fk: 9.0, pddd: 2.5, roe: 30 },
  'Metal': { fk: 7.0, pddd: 1.2, roe: 18 },
  'Ulasim': { fk: 5.5, pddd: 2.0, roe: 38 },
  'Savunma': { fk: 20.0, pddd: 4.0, roe: 18 },
  'Genel': { fk: 9.0, pddd: 1.5, roe: 18 },
};

// Haberler - Google News RSS (her yerden erisim saglar)
async function fetchNews(symbol) {
  const results = [];
  const shortSymbol = symbol ? symbol.replace('.IS', '') : '';
  const query = symbol ? `${shortSymbol} borsa hisse` : 'BIST borsa Türkiye hisse';

  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=tr&gl=TR&ceid=TR:tr`;
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000,
      responseType: 'text'
    });
    const xml = res.data;
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    for (const item of items.slice(0, 20)) {
      const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '')?.trim() || '';
      const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
      const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
      const source = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '')?.trim() || '';
      if (title && title.length > 5) {
        results.push({ title, link, date: pubDate, company: shortSymbol, source });
      }
    }
  } catch(e) {
    console.log('Google News hatasi:', e.message);
  }

  // Yedek: Yahoo Finance haberleri
  if (results.length === 0 && symbol) {
    try {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}&newsCount=15&quotesCount=0`;
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 8000
      });
      const news = res.data?.news || [];
      for (const n of news) {
        results.push({
          title: n.title,
          link: n.link,
          date: new Date(n.providerPublishTime * 1000).toUTCString(),
          company: shortSymbol,
          source: n.publisher,
        });
      }
    } catch(e) {
      console.log('Yahoo haber hatasi:', e.message);
    }
  }

  return results;
}

// Yahoo Finance fiyat verisi
async function fetchYahooPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`;
  const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
  return res.data;
}

// Teknik gostergeler
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
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calcMACD(closes) {
  if (closes.length < 26) return { macd: null };
  const macd = calcEMA(closes, 12) - calcEMA(closes, 26);
  return { macd: macd.toFixed(2) };
}

function calcBB(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period);
  return { upper: (sma + 2 * std).toFixed(2), middle: sma.toFixed(2), lower: (sma - 2 * std).toFixed(2) };
}

// Rating hesaplama
function calculateRating(fund, tech, sentiment) {
  let score = 0;
  const details = [];
  if (fund) {
    const bench = SECTOR_BENCHMARKS[fund.sector] || SECTOR_BENCHMARKS['Genel'];
    if (fund.fk && fund.fk > 0) {
      const s = fund.fk < bench.fk * 0.7 ? 12 : fund.fk < bench.fk ? 8 : fund.fk < bench.fk * 1.5 ? 4 : 0;
      score += s;
      details.push({ label: 'F/K orani', score: s, max: 12, note: `${fund.fk.toFixed(1)}x / sektor: ${bench.fk}x` });
    }
    if (fund.pddd && fund.pddd > 0) {
      const s = fund.pddd < bench.pddd * 0.6 ? 12 : fund.pddd < bench.pddd ? 8 : fund.pddd < bench.pddd * 1.5 ? 4 : 0;
      score += s;
      details.push({ label: 'PD/DD orani', score: s, max: 12, note: `${fund.pddd.toFixed(2)}x / sektor: ${bench.pddd}x` });
    }
    if (fund.roe && fund.roe > 0) {
      const s = fund.roe > bench.roe * 1.3 ? 16 : fund.roe > bench.roe ? 12 : fund.roe > bench.roe * 0.7 ? 6 : 0;
      score += s;
      details.push({ label: 'ROE', score: s, max: 16, note: `${fund.roe.toFixed(1)}% / sektor: ${bench.roe}%` });
    }
  }
  if (tech) {
    if (tech.rsi != null) {
      const s = tech.rsi >= 30 && tech.rsi <= 70 ? 15 : tech.rsi < 30 ? 12 : 5;
      score += s;
      details.push({ label: 'RSI', score: s, max: 15, note: `${tech.rsi} - ${tech.rsi < 30 ? 'Asiri satim' : tech.rsi > 70 ? 'Asiri alim' : 'Notr'}` });
    }
    if (tech.trend) {
      const s = tech.trend === 'yukari' ? 20 : tech.trend === 'yatay' ? 10 : 2;
      score += s;
      details.push({ label: 'Trend', score: s, max: 20, note: tech.trend === 'yukari' ? 'Yukselis trendi' : tech.trend === 'yatay' ? 'Yatay seyir' : 'Dusus trendi' });
    }
  }
  if (sentiment != null) {
    const s = sentiment > 0.3 ? 25 : sentiment > 0 ? 18 : sentiment > -0.3 ? 10 : 2;
    score += s;
    details.push({ label: 'Haber sentimanti', score: s, max: 25, note: sentiment > 0.3 ? 'Pozitif' : sentiment < -0.3 ? 'Negatif' : 'Notr' });
  }
  const grade = score >= 75 ? 'GUCLU AL' : score >= 55 ? 'AL' : score >= 35 ? 'BEKLE' : score >= 20 ? 'SAT' : 'GUCLU SAT';
  const color = score >= 75 ? '#22c55e' : score >= 55 ? '#86efac' : score >= 35 ? '#fbbf24' : score >= 20 ? '#f87171' : '#ef4444';
  return { score, grade, color, details };
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────

app.get('/api/stock/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = cache.get(`stock_${symbol}`);
  if (cached) return res.json(cached);
  try {
    const data = await fetchYahooPrice(symbol);
    const chart = data.chart?.result?.[0];
    if (!chart) return res.status(404).json({ error: 'Hisse bulunamadi' });
    const closes = chart.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
    const timestamps = chart.timestamp || [];
    const volumes = chart.indicators?.quote?.[0]?.volume?.filter(v => v != null) || [];
    if (closes.length < 2) return res.status(404).json({ error: 'Yeterli veri yok' });
    const cur = closes[closes.length - 1], prev = closes[closes.length - 2];
    const sma20 = calcSMA(closes, 20), sma50 = calcSMA(closes, 50), sma200 = calcSMA(closes, 200);
    let trend = 'yatay';
    if (sma20 && sma50 && cur > sma20 && sma20 > sma50) trend = 'yukari';
    else if (sma20 && sma50 && cur < sma20 && sma20 < sma50) trend = 'asagi';
    const result = {
      symbol, currentPrice: cur.toFixed(2),
      change: (cur - prev).toFixed(2), changePercent: ((cur - prev) / prev * 100).toFixed(2),
      volume: volumes[volumes.length - 1],
      high52w: Math.max(...closes).toFixed(2), low52w: Math.min(...closes).toFixed(2),
      technical: {
        rsi: calcRSI(closes), macd: calcMACD(closes),
        sma20: sma20?.toFixed(2), sma50: sma50?.toFixed(2), sma200: sma200?.toFixed(2),
        bb: calcBB(closes), trend,
      },
      chart: {
        dates: timestamps.slice(-90).map(t => new Date(t * 1000).toLocaleDateString('tr-TR')),
        closes: closes.slice(-90).map(v => v.toFixed(2)),
        volumes: volumes.slice(-90),
      },
    };
    cache.set(`stock_${symbol}`, result);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/fundamentals/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = cache.get(`fund_${symbol}`);
  if (cached) return res.json(cached);
  const manual = FUNDAMENTALS_DB[symbol];
  if (manual) {
    const result = { symbol, ...manual, source: 'BIST Intelligence DB' };
    cache.set(`fund_${symbol}`, result);
    return res.json(result);
  }
  // Bilmedigimiz hisse icin Yahoo dene
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=financialData,defaultKeyStatistics,summaryDetail,assetProfile`;
    const res2 = await axios.get(url, { headers, timeout: 10000 });
    const s = res2.data.quoteSummary?.result?.[0];
    if (s) {
      const fin = s.financialData || {}, stats = s.defaultKeyStatistics || {};
      const detail = s.summaryDetail || {}, profile = s.assetProfile || {};
      const eps = stats.trailingEps?.raw, price = detail.regularMarketPrice?.raw;
      const result = {
        symbol, sector: profile.sector || 'Genel', industry: profile.industry || '',
        fk: detail.trailingPE?.raw || (price && eps ? price / eps : null),
        pddd: stats.priceToBook?.raw || null,
        roe: fin.returnOnEquity?.raw ? fin.returnOnEquity.raw * 100 : null,
        ros: fin.profitMargins?.raw ? fin.profitMargins.raw * 100 : null,
        eps, marketCap: stats.marketCap?.raw || null, beta: stats.beta?.raw || null,
        dividendYield: detail.dividendYield?.raw ? detail.dividendYield.raw * 100 : null,
        source: 'Yahoo Finance',
      };
      cache.set(`fund_${symbol}`, result);
      return res.json(result);
    }
  } catch(e) { console.log('Yahoo fund hatasi:', e.message); }
  res.json({ symbol, sector: 'Genel', fk: null, pddd: null, roe: null });
});

app.get('/api/news', async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  const cacheKey = `news_${symbol || 'all'}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);
  try {
    let news = await fetchNews(symbol);
    if (news.length > 0 && process.env.ANTHROPIC_API_KEY) {
      try {
        const titles = news.slice(0, 12).map((n, i) => `${i + 1}. ${n.title}`).join('\n');
        const msg = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514', max_tokens: 800,
          messages: [{
            role: 'user',
            content: `Asagidaki haber basliklarini tek tek analiz et. Her biri icin "olumlu", "olumsuz" veya "notr" yaz. Genel sentimant skoru -1 ile 1 arasinda ver. SADECE JSON don, hic baska sey yazma:
{"items":[{"sentiment":"olumlu","score":0.8},{"sentiment":"notr","score":0}],"overall":0.3}

Haberler:
${titles}`
          }]
        });
        const raw = msg.content[0].text.trim();
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          news = news.slice(0, 12).map((n, i) => ({
            ...n,
            sentiment: parsed.items?.[i]?.sentiment || 'notr',
            sentimentScore: parsed.items?.[i]?.score || 0,
          }));
          const result = { news, overallSentiment: parsed.overall || 0 };
          cache.set(cacheKey, result);
          return res.json(result);
        }
      } catch(e) { console.log('AI sentimant hatasi:', e.message); }
    }
    const result = { news: news.slice(0, 15), overallSentiment: 0 };
    cache.set(cacheKey, result);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message, news: [], overallSentiment: 0 }); }
});

app.get('/api/analyze/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cached = cache.get(`analyze_${symbol}`);
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
  const tech = stock ? { rsi: stock.technical?.rsi, trend: stock.technical?.trend } : null;
  const rating = calculateRating(fund, tech, newsData?.overallSentiment ?? 0);
  const bench = SECTOR_BENCHMARKS[fund?.sector] || SECTOR_BENCHMARKS['Genel'];
  const sectorComparison = fund ? {
    sector: fund.sector || 'Genel',
    fkVsSector: fund.fk ? ((fund.fk - bench.fk) / bench.fk * 100).toFixed(1) : null,
    pdddVsSector: fund.pddd ? ((fund.pddd - bench.pddd) / bench.pddd * 100).toFixed(1) : null,
    roeVsSector: fund.roe ? ((fund.roe - bench.roe) / bench.roe * 100).toFixed(1) : null,
  } : null;
  const result = { symbol, stock, fund, newsData, rating, sectorComparison };
  cache.set(`analyze_${symbol}`, result);
  res.json(result);
});

app.post('/api/chat', async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: 'Mesaj gerekli' });
  try {
    const contextStr = context ? `\n\nMevcut analiz: Sembol=${context.symbol}, Rating=${context.rating}` : '';
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 1000,
      system: `Sen uzman bir Turk borsa analistisin. BIST hisseleri, Turk ekonomisi ve global piyasalar hakkinda net, analitik cevaplar ver. RSI, MACD, Bollinger, F/K, PD/DD, ROE konularinda uzmansin. Turkce yaz. Yatirim tavsiyesi vermedigini belirt.${contextStr}`,
      messages: [{ role: 'user', content: message }],
    });
    res.json({ response: msg.content[0].text });
  } catch(e) { res.status(500).json({ error: 'AI baglantisi kurulamadi: ' + e.message }); }
});

app.get('/api/watchlist', async (req, res) => {
  const symbols = ['THYAO.IS', 'EREGL.IS', 'AKBNK.IS', 'GARAN.IS', 'ASELS.IS', 'KCHOL.IS', 'BIMAS.IS', 'TCELL.IS'];
  const cached = cache.get('watchlist');
  if (cached) return res.json(cached);
  const results = await Promise.allSettled(symbols.map(s =>
    axios.get(`http://localhost:${PORT}/api/stock/${s}`, { timeout: 8000 })
  ));
  const data = results.filter(r => r.status === 'fulfilled').map(r => r.value.data);
  cache.set('watchlist', data);
  res.json(data);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Borsa AI calisiyor: http://localhost:${PORT}`));
