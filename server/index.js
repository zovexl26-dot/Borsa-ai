require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const NodeCache = require('node-cache');
const RSSParser = require('rss-parser');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const cache = new NodeCache({ stdTTL: 300 }); // 5 dakika cache
const rssParser = new RSSParser();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── YARDIMCI FONKSİYONLAR ───────────────────────────────────────────────────

function cacheGet(key) { return cache.get(key); }
function cacheSet(key, val) { cache.set(key, val); }

// Yahoo Finance'dan hisse verisi
async function fetchYahooData(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`;
  const headers = { 'User-Agent': 'Mozilla/5.0' };
  const res = await axios.get(url, { headers, timeout: 10000 });
  return res.data;
}

// Yahoo Finance fundamentals
async function fetchFundamentals(symbol) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=financialData,defaultKeyStatistics,summaryDetail,assetProfile`;
  const headers = { 'User-Agent': 'Mozilla/5.0' };
  const res = await axios.get(url, { headers, timeout: 10000 });
  return res.data;
}

// KAP RSS haberleri
async function fetchKAPNews() {
  try {
    const feed = await rssParser.parseURL('https://www.kap.org.tr/tr/rss/bildirim');
    return feed.items.slice(0, 30).map(item => ({
      title: item.title,
      date: item.pubDate,
      link: item.link,
      company: item.title?.split(' ')[0] || '',
    }));
  } catch (e) {
    // KAP erişilemezse örnek veri
    return [];
  }
}

// Sektör karşılaştırma verileri (Türk hisseleri)
const SECTOR_BENCHMARKS = {
  'Bankacılık': { fk: 6.5, pddd: 0.85, roe: 13 },
  'Holding': { fk: 8.0, pddd: 0.6, roe: 10 },
  'Perakende': { fk: 12.0, pddd: 2.1, roe: 17 },
  'Enerji': { fk: 9.5, pddd: 1.2, roe: 12 },
  'Teknoloji': { fk: 18.0, pddd: 3.5, roe: 20 },
  'İnşaat': { fk: 7.0, pddd: 1.0, roe: 14 },
  'Sağlık': { fk: 14.0, pddd: 2.8, roe: 18 },
  'Gıda': { fk: 10.0, pddd: 1.5, roe: 15 },
  'Genel': { fk: 10.0, pddd: 1.5, roe: 14 },
};

// Teknik göstergeler hesaplama
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - (100 / (1 + rs)));
}

function calcSMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcMACD(closes) {
  if (closes.length < 26) return { macd: null, signal: null, histogram: null };
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12 - ema26;
  return { macd: macdLine.toFixed(2), histogram: macdLine.toFixed(2) };
}

function calcEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcBollingerBands(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: (sma + 2 * std).toFixed(2), middle: sma.toFixed(2), lower: (sma - 2 * std).toFixed(2) };
}

// ─── RATING HESAPLA ──────────────────────────────────────────────────────────

function calculateRating(fundamental, technical, sentiment) {
  let score = 0;
  let details = [];

  // Temel analiz skoru (40 puan)
  if (fundamental) {
    const { fk, pddd, roe, sector } = fundamental;
    const bench = SECTOR_BENCHMARKS[sector] || SECTOR_BENCHMARKS['Genel'];

    if (fk && fk > 0) {
      const fkScore = fk < bench.fk * 0.7 ? 12 : fk < bench.fk ? 8 : fk < bench.fk * 1.5 ? 4 : 0;
      score += fkScore;
      details.push({ label: 'F/K oranı', score: fkScore, max: 12, note: `${fk.toFixed(1)}x (sektör: ${bench.fk}x)` });
    }
    if (pddd && pddd > 0) {
      const pdScore = pddd < bench.pddd * 0.6 ? 12 : pddd < bench.pddd ? 8 : pddd < bench.pddd * 1.5 ? 4 : 0;
      score += pdScore;
      details.push({ label: 'PD/DD oranı', score: pdScore, max: 12, note: `${pddd.toFixed(2)}x (sektör: ${bench.pddd}x)` });
    }
    if (roe && roe > 0) {
      const roeScore = roe > bench.roe * 1.3 ? 16 : roe > bench.roe ? 12 : roe > bench.roe * 0.7 ? 6 : 0;
      score += roeScore;
      details.push({ label: 'ROE', score: roeScore, max: 16, note: `${roe.toFixed(1)}% (sektör: ${bench.roe}%)` });
    }
  }

  // Teknik analiz skoru (35 puan)
  if (technical) {
    const { rsi, macd, trend } = technical;
    if (rsi !== null) {
      const rsiScore = rsi >= 30 && rsi <= 70 ? 15 : rsi < 30 ? 12 : 5;
      score += rsiScore;
      details.push({ label: 'RSI', score: rsiScore, max: 15, note: `${rsi} (${rsi < 30 ? 'Aşırı satım' : rsi > 70 ? 'Aşırı alım' : 'Nötr bölge'})` });
    }
    if (trend) {
      const tScore = trend === 'yukari' ? 20 : trend === 'yatay' ? 10 : 2;
      score += tScore;
      details.push({ label: 'Trend', score: tScore, max: 20, note: trend === 'yukari' ? 'Yükselen trend' : trend === 'yatay' ? 'Yatay seyir' : 'Düşen trend' });
    }
  }

  // Haber sentimant skoru (25 puan)
  if (sentiment !== undefined) {
    const sentScore = sentiment > 0.3 ? 25 : sentiment > 0 ? 18 : sentiment > -0.3 ? 10 : 2;
    score += sentScore;
    details.push({ label: 'Haber sentimantı', score: sentScore, max: 25, note: sentiment > 0.3 ? 'Pozitif haberler' : sentiment < -0.3 ? 'Negatif haberler' : 'Nötr haberler' });
  }

  const grade = score >= 75 ? 'GÜÇLÜ AL' : score >= 55 ? 'AL' : score >= 35 ? 'BEKLE' : score >= 20 ? 'SAT' : 'GÜÇLÜ SAT';
  const color = score >= 75 ? '#22c55e' : score >= 55 ? '#86efac' : score >= 35 ? '#fbbf24' : score >= 20 ? '#f87171' : '#ef4444';

  return { score, grade, color, details, maxScore: 100 };
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// Hisse fiyat + teknik analiz
app.get('/api/stock/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cacheKey = `stock_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await fetchYahooData(symbol);
    const chart = data.chart?.result?.[0];
    if (!chart) return res.status(404).json({ error: 'Hisse bulunamadı' });

    const closes = chart.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
    const timestamps = chart.timestamp || [];
    const volumes = chart.indicators?.quote?.[0]?.volume?.filter(Boolean) || [];
    const opens = chart.indicators?.quote?.[0]?.open?.filter(Boolean) || [];
    const highs = chart.indicators?.quote?.[0]?.high?.filter(Boolean) || [];
    const lows = chart.indicators?.quote?.[0]?.low?.filter(Boolean) || [];

    const currentPrice = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const change = currentPrice - prevClose;
    const changePercent = (change / prevClose) * 100;

    const sma20 = calcSMA(closes, 20);
    const sma50 = calcSMA(closes, 50);
    const sma200 = calcSMA(closes, 200);
    const rsi = calcRSI(closes);
    const macd = calcMACD(closes);
    const bb = calcBollingerBands(closes);

    // Trend belirleme
    let trend = 'yatay';
    if (sma20 && sma50 && sma200) {
      if (currentPrice > sma20 && sma20 > sma50 && sma50 > sma200) trend = 'yukari';
      else if (currentPrice < sma20 && sma20 < sma50) trend = 'asagi';
    }

    const result = {
      symbol,
      currentPrice: currentPrice?.toFixed(2),
      change: change?.toFixed(2),
      changePercent: changePercent?.toFixed(2),
      volume: volumes[volumes.length - 1],
      high52w: Math.max(...closes).toFixed(2),
      low52w: Math.min(...closes).toFixed(2),
      technical: { rsi, macd, sma20: sma20?.toFixed(2), sma50: sma50?.toFixed(2), sma200: sma200?.toFixed(2), bb, trend },
      chart: {
        dates: timestamps.slice(-60).map(t => new Date(t * 1000).toLocaleDateString('tr-TR')),
        closes: closes.slice(-60).map(v => v?.toFixed(2)),
        volumes: volumes.slice(-60),
      },
    };

    cacheSet(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.error('Stock error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Temel analiz verileri
app.get('/api/fundamentals/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cacheKey = `fund_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await fetchFundamentals(symbol);
    const summary = data.quoteSummary?.result?.[0];
    if (!summary) return res.status(404).json({ error: 'Temel veri bulunamadı' });

    const fin = summary.financialData || {};
    const stats = summary.defaultKeyStatistics || {};
    const detail = summary.summaryDetail || {};
    const profile = summary.assetProfile || {};

    const result = {
      symbol,
      sector: profile.sector || 'Genel',
      industry: profile.industry || '',
      employees: profile.fullTimeEmployees,
      fk: detail.trailingPE?.raw || stats.trailingEps?.raw ? (detail.regularMarketPrice?.raw / stats.trailingEps?.raw) : null,
      pddd: stats.priceToBook?.raw || null,
      roe: fin.returnOnEquity?.raw ? (fin.returnOnEquity.raw * 100) : null,
      ros: fin.profitMargins?.raw ? (fin.profitMargins.raw * 100) : null,
      eps: stats.trailingEps?.raw || null,
      marketCap: stats.marketCap?.raw || null,
      beta: stats.beta?.raw || null,
      dividendYield: detail.dividendYield?.raw ? (detail.dividendYield.raw * 100) : null,
      debtToEquity: fin.debtToEquity?.raw || null,
      currentRatio: fin.currentRatio?.raw || null,
      grossMargin: fin.grossMargins?.raw ? (fin.grossMargins.raw * 100) : null,
      operatingMargin: fin.operatingMargins?.raw ? (fin.operatingMargins.raw * 100) : null,
      revenueGrowth: fin.revenueGrowth?.raw ? (fin.revenueGrowth.raw * 100) : null,
      earningsGrowth: fin.earningsGrowth?.raw ? (fin.earningsGrowth.raw * 100) : null,
    };

    cacheSet(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.error('Fundamentals error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// KAP Haberleri
app.get('/api/news', async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  const cacheKey = `news_${symbol || 'all'}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    let news = await fetchKAPNews();
    if (symbol) {
      const shortSymbol = symbol.replace('.IS', '');
      news = news.filter(n => n.title?.toUpperCase().includes(shortSymbol));
    }

    // Sentimant analizi için Claude kullan
    if (news.length > 0 && process.env.ANTHROPIC_API_KEY) {
      const titles = news.slice(0, 10).map(n => n.title).join('\n');
      try {
        const msg = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `Aşağıdaki KAP haberlerini analiz et. Her haber için "olumlu", "olumsuz" veya "nötr" yaz ve -1 ile 1 arasında genel sentimant skoru ver. JSON formatında yanıt ver:
{"items": [{"title": "...", "sentiment": "olumlu/olumsuz/nötr", "score": 0.5}], "overall": 0.2}

Haberler:
${titles}`
          }]
        });
        const raw = msg.content[0].text;
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          news = news.slice(0, 10).map((n, i) => ({
            ...n,
            sentiment: parsed.items?.[i]?.sentiment || 'nötr',
            sentimentScore: parsed.items?.[i]?.score || 0,
          }));
          const result = { news, overallSentiment: parsed.overall || 0 };
          cacheSet(cacheKey, result);
          return res.json(result);
        }
      } catch (e) {
        console.error('Sentiment error:', e.message);
      }
    }

    const result = { news, overallSentiment: 0 };
    cacheSet(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.error('News error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Tam analiz (temel + teknik + haber → rating)
app.get('/api/analyze/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const cacheKey = `analyze_${symbol}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const [stockRes, fundRes, newsRes] = await Promise.allSettled([
      axios.get(`http://localhost:${PORT}/api/stock/${symbol}`),
      axios.get(`http://localhost:${PORT}/api/fundamentals/${symbol}`),
      axios.get(`http://localhost:${PORT}/api/news?symbol=${symbol}`),
    ]);

    const stock = stockRes.status === 'fulfilled' ? stockRes.value.data : null;
    const fund = fundRes.status === 'fulfilled' ? fundRes.value.data : null;
    const newsData = newsRes.status === 'fulfilled' ? newsRes.value.data : null;

    const fundamental = fund ? {
      fk: fund.fk, pddd: fund.pddd, roe: fund.roe,
      sector: fund.sector || 'Genel',
    } : null;

    const technical = stock ? {
      rsi: stock.technical?.rsi,
      macd: stock.technical?.macd,
      trend: stock.technical?.trend,
    } : null;

    const sentiment = newsData?.overallSentiment ?? 0;

    const rating = calculateRating(fundamental, technical, sentiment);

    // Sektör karşılaştırma
    const sectorBench = SECTOR_BENCHMARKS[fund?.sector] || SECTOR_BENCHMARKS['Genel'];
    const sectorComparison = fund ? {
      sector: fund.sector || 'Genel',
      fkVsSector: fund.fk ? ((fund.fk - sectorBench.fk) / sectorBench.fk * 100).toFixed(1) : null,
      pdddVsSector: fund.pddd ? ((fund.pddd - sectorBench.pddd) / sectorBench.pddd * 100).toFixed(1) : null,
      roeVsSector: fund.roe ? ((fund.roe - sectorBench.roe) / sectorBench.roe * 100).toFixed(1) : null,
    } : null;

    const result = { symbol, stock, fund, newsData, rating, sectorComparison };
    cacheSet(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.error('Analyze error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// AI Chat
app.post('/api/chat', async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: 'Mesaj gerekli' });

  try {
    const systemPrompt = `Sen uzman bir Türk borsa analisti ve finansal danışmansın. 
Kullanıcıya BIST hisseleri, Türk ekonomisi ve global piyasalar hakkında net, pratik ve analitik cevaplar ver.
Teknik analiz (RSI, MACD, Bollinger Bands, MA), temel analiz (F/K, PD/DD, ROE) konularında derinlemesine bilgi sahibisin.
KAP haberleri ve şirket duyurularını yorumlayabilirsin.
Yanıtların özlü ama kapsamlı olsun. Risk uyarılarını unutma.
${context ? `\n\nMevcut analiz bağlamı:\n${JSON.stringify(context, null, 2)}` : ''}`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
    });

    res.json({ response: msg.content[0].text });
  } catch (e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Popüler BIST hisseleri
app.get('/api/watchlist', async (req, res) => {
  const symbols = ['THYAO.IS', 'EREGL.IS', 'AKBNK.IS', 'GARAN.IS', 'ASELS.IS', 'KCHOL.IS', 'BIMAS.IS', 'TCELL.IS'];
  const cacheKey = 'watchlist';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const results = await Promise.allSettled(
      symbols.map(s => axios.get(`http://localhost:${PORT}/api/stock/${s}`, { timeout: 8000 }))
    );
    const data = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value.data);
    cacheSet(cacheKey, data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Borsa AI çalışıyor: http://localhost:${PORT}`);
});
