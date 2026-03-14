# 🏛 BIST Intelligence — Borsa AI

Temel analiz, teknik analiz, KAP haberleri ve AI chat özelliklerini tek çatı altında toplayan, Railway'de ücretsiz çalışan bir borsa analiz platformu.

## Özellikler

- **Temel Analiz**: F/K, PD/DD, ROE, EPS, Beta, Temettü, Brüt Kar Marjı ve daha fazlası
- **Teknik Analiz**: RSI, MACD, SMA 20/50/200, Bollinger Bands, Trend
- **KAP Haberleri**: AI ile olumlu/olumsuz/nötr sentimant analizi
- **AI Rating**: Temel + teknik + haber → 0-100 puan, GÜÇLÜ AL / AL / BEKLE / SAT / GÜÇLÜ SAT
- **Sektör Karşılaştırması**: F/K, PD/DD, ROE sektör ortalamasıyla kıyaslama
- **AI Chat**: Claude ile borsa analisti sohbeti
- **CORS Sıfır**: Tüm dış API çağrıları backend'den yapılır

## Railway'e Deploy (Ücretsiz)

### 1. GitHub'a yükle
```bash
git init
git add .
git commit -m "ilk commit"
git remote add origin https://github.com/KULLANICI_ADIN/borsa-ai.git
git push -u origin main
```

### 2. Railway hesabı aç
1. https://railway.app → GitHub ile giriş yap (ücretsiz)
2. "New Project" → "Deploy from GitHub repo" → `borsa-ai` seç
3. Otomatik deploy başlar

### 3. Environment Variables ekle
Railway dashboard → Variables:
```
ANTHROPIC_API_KEY = sk-ant-...buraya_kendi_key_ini_yaz...
```

### 4. Domain al
Railway → Settings → Domains → "Generate Domain" → `borsa-ai-xxx.up.railway.app` ücretsiz

## Lokal Çalıştırma
```bash
# Bağımlılıkları kur
npm install

# .env dosyası oluştur
cp .env.example .env
# .env içine ANTHROPIC_API_KEY ekle

# Başlat
npm start
# → http://localhost:3000
```

## API Endpoints

| Endpoint | Açıklama |
|---|---|
| GET /api/stock/:symbol | Fiyat + teknik analiz |
| GET /api/fundamentals/:symbol | Temel analiz verileri |
| GET /api/news?symbol= | KAP haberleri + sentimant |
| GET /api/analyze/:symbol | Tam analiz + rating |
| POST /api/chat | AI sohbet |
| GET /api/watchlist | Popüler BIST hisseleri |

## Sembol Formatı
- BIST hisseleri: `THYAO.IS`, `GARAN.IS`, `EREGL.IS`
- ABD hisseleri de çalışır: `AAPL`, `TSLA`

## Not
- Yahoo Finance API ücretsiz, limit yok (sunucu tarafında cache ile)
- KAP RSS ücretsiz
- Claude API ücretli (çok düşük — 1000 istek ~$1)
- Railway ücretsiz tier: ayda 500 saat, yeterli
