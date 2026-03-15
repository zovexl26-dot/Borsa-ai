import os
import math
import re
from datetime import datetime, timedelta
from xml.etree import ElementTree as ET
from email.utils import parsedate_to_datetime
from flask import Flask, render_template, request, jsonify
import yfinance as yf
import pandas as pd
import requests
import anthropic
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

CLAUDE_MODEL = "claude-haiku-4-5-20251001"

SECTOR_PEERS = {
    "Otomotiv": ["FROTO.IS", "TOASO.IS", "OTKAR.IS", "DOAS.IS"],
    "Bankacilik": ["GARAN.IS", "AKBNK.IS", "ISCTR.IS", "YKBNK.IS", "HALKB.IS"],
    "Havacilik": ["THYAO.IS", "PGSUS.IS"],
    "Savunma": ["ASELS.IS", "ROKET.IS"],
    "Demir-Celik": ["EREGL.IS", "KRDMD.IS"],
    "Perakende": ["BIMAS.IS", "MIGROS.IS", "SOKM.IS"],
    "Petrol": ["TUPRS.IS", "AYGAZ.IS"],
    "Holding": ["KCHOL.IS", "SAHOL.IS", "SISE.IS"],
    "Telekom": ["TCELL.IS", "TTKOM.IS"],
}

SEKTOR_MAP = {
    "consumer cyclical": "Otomotiv",
    "financial services": "Bankacilik",
    "industrials": "Havacilik",
    "technology": "Savunma",
    "basic materials": "Demir-Celik",
    "consumer defensive": "Perakende",
    "energy": "Petrol",
    "communication services": "Telekom",
}

HTTP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
}

POZITIF_KELIMELER = [
    "artış", "yükseliş", "büyüme", "kâr", "kar", "rekor", "güçlü", "olumlu",
    "başarı", "kazanç", "temettü", "ihracat", "anlaşma", "sözleşme", "yatırım",
    "genişleme", "prim", "rally", "toparlanma", "iyileşme", "beat", "üzerinde",
    "arttı", "yükseldi", "pozitif", "strong", "gain", "rise", "up", "growth"
]

OLUMSUZ_KELIMELER = [
    "düşüş", "kayıp", "zarar", "risk", "uyarı", "endişe", "gerileme", "kriz",
    "satış", "baskı", "zayıf", "olumsuz", "iflas", "borç", "dava", "soruşturma",
    "ceza", "azalış", "düştü", "geriledi", "negatif", "weak", "loss", "down",
    "fall", "drop", "decline", "below", "miss", "sell"
]


def temizle_sayi(deger):
    if deger is None:
        return None
    try:
        if isinstance(deger, (int, float)):
            if math.isnan(deger) or math.isinf(deger):
                return None
        return deger
    except Exception:
        return None


def format_buyuk_sayi(sayi):
    if sayi is None:
        return "Veri yok"
    try:
        sayi = float(sayi)
        if abs(sayi) >= 1e12:
            return f"{sayi/1e12:.2f}T"
        elif abs(sayi) >= 1e9:
            return f"{sayi/1e9:.2f}B"
        elif abs(sayi) >= 1e6:
            return f"{sayi/1e6:.2f}M"
        elif abs(sayi) >= 1e3:
            return f"{sayi/1e3:.2f}K"
        else:
            return f"{sayi:.2f}"
    except Exception:
        return "Veri yok"


def sembol_duzenle(sembol):
    sembol = sembol.upper().strip()
    if not sembol.endswith(".IS"):
        sembol = sembol + ".IS"
    return sembol


def rsi_hesapla(kapanislar, periyot=14):
    try:
        delta = kapanislar.diff()
        kazan = delta.clip(lower=0)
        kayip = (-delta).clip(lower=0)
        # Wilder's RMA (TradingView ile birebir)
        alpha = 1.0 / periyot
        ort_kazan = kazan.ewm(alpha=alpha, adjust=False, min_periods=periyot).mean()
        ort_kayip = kayip.ewm(alpha=alpha, adjust=False, min_periods=periyot).mean()
        rs = ort_kazan / ort_kayip
        rsi = 100 - (100 / (1 + rs))
        return float(rsi.iloc[-1]) if not pd.isna(rsi.iloc[-1]) else None
    except Exception:
        return None


def macd_hesapla(kapanislar, hizli=12, yavas=26, sinyal=9):
    try:
        ema_hizli = kapanislar.ewm(span=hizli, adjust=False).mean()
        ema_yavas = kapanislar.ewm(span=yavas, adjust=False).mean()
        macd_hat = ema_hizli - ema_yavas
        sinyal_hat = macd_hat.ewm(span=sinyal, adjust=False).mean()
        histogram = macd_hat - sinyal_hat
        return {
            "macd": float(macd_hat.iloc[-1]) if not pd.isna(macd_hat.iloc[-1]) else None,
            "sinyal": float(sinyal_hat.iloc[-1]) if not pd.isna(sinyal_hat.iloc[-1]) else None,
            "histogram": float(histogram.iloc[-1]) if not pd.isna(histogram.iloc[-1]) else None,
        }
    except Exception:
        return {"macd": None, "sinyal": None, "histogram": None}


def bollinger_hesapla(kapanislar, periyot=20, std_sapma=2):
    try:
        ort = kapanislar.rolling(window=periyot).mean()
        std = kapanislar.rolling(window=periyot).std()
        return {
            "ust": float((ort + std * std_sapma).iloc[-1]),
            "orta": float(ort.iloc[-1]),
            "alt": float((ort - std * std_sapma).iloc[-1]),
        }
    except Exception:
        return {"ust": None, "orta": None, "alt": None}


def stokastik_hesapla(veri, k_periyot=14, d_periyot=3):
    try:
        en_dusuk = veri["Low"].rolling(window=k_periyot).min()
        en_yuksek = veri["High"].rolling(window=k_periyot).max()
        k = 100 * ((veri["Close"] - en_dusuk) / (en_yuksek - en_dusuk))
        d = k.rolling(window=d_periyot).mean()
        return {
            "k": float(k.iloc[-1]) if not pd.isna(k.iloc[-1]) else None,
            "d": float(d.iloc[-1]) if not pd.isna(d.iloc[-1]) else None,
        }
    except Exception:
        return {"k": None, "d": None}


def teknik_veri_cek(sembol):
    veri = {}
    try:
        hisse = yf.Ticker(sembol)
        tarihsel = hisse.history(period="2y", auto_adjust=True, actions=False)
        if tarihsel.empty:
            return None

        kapanislar = tarihsel["Close"]
        guncel_fiyat = float(kapanislar.iloc[-1])
        onceki_fiyat = float(kapanislar.iloc[-2]) if len(kapanislar) > 1 else guncel_fiyat

        veri["guncel_fiyat"] = round(guncel_fiyat, 2)
        veri["gunluk_degisim"] = round(((guncel_fiyat - onceki_fiyat) / onceki_fiyat) * 100, 2)
        veri["52_hafta_yuksek"] = round(float(kapanislar.max()), 2)
        veri["52_hafta_dusuk"] = round(float(kapanislar.min()), 2)
        veri["hacim"] = int(tarihsel["Volume"].iloc[-1])
        veri["ort_hacim"] = int(tarihsel["Volume"].mean())

        veri["ma20"] = round(float(kapanislar.rolling(20).mean().iloc[-1]), 2) if len(kapanislar) >= 20 else None
        veri["ma50"] = round(float(kapanislar.rolling(50).mean().iloc[-1]), 2) if len(kapanislar) >= 50 else None
        veri["ma200"] = round(float(kapanislar.rolling(200).mean().iloc[-1]), 2) if len(kapanislar) >= 200 else None
        veri["ma20_durum"] = "Üzerinde" if veri["ma20"] and guncel_fiyat > veri["ma20"] else "Altinda"
        veri["ma50_durum"] = "Üzerinde" if veri["ma50"] and guncel_fiyat > veri["ma50"] else "Altinda"
        veri["ma200_durum"] = "Üzerinde" if veri["ma200"] and guncel_fiyat > veri["ma200"] else "Altinda"

        rsi_val = rsi_hesapla(kapanislar)
        veri["rsi"] = round(rsi_val, 2) if rsi_val else None

        macd = macd_hesapla(kapanislar)
        veri["macd"] = round(macd["macd"], 4) if macd["macd"] else None
        veri["macd_sinyal"] = round(macd["sinyal"], 4) if macd["sinyal"] else None
        veri["macd_histogram"] = round(macd["histogram"], 4) if macd["histogram"] else None

        b = bollinger_hesapla(kapanislar)
        veri["bollinger_ust"] = round(b["ust"], 2) if b["ust"] else None
        veri["bollinger_orta"] = round(b["orta"], 2) if b["orta"] else None
        veri["bollinger_alt"] = round(b["alt"], 2) if b["alt"] else None

        stok = stokastik_hesapla(tarihsel)
        veri["stok_k"] = round(stok["k"], 2) if stok["k"] else None
        veri["stok_d"] = round(stok["d"], 2) if stok["d"] else None

        son20 = tarihsel.tail(20)
        veri["destek"] = round(float(son20["Low"].min()), 2)
        veri["direnc"] = round(float(son20["High"].max()), 2)

        try:
            veri["perf_1ay"] = round(((guncel_fiyat - float(kapanislar.iloc[-22])) / float(kapanislar.iloc[-22])) * 100, 2) if len(kapanislar) >= 22 else None
            veri["perf_3ay"] = round(((guncel_fiyat - float(kapanislar.iloc[-66])) / float(kapanislar.iloc[-66])) * 100, 2) if len(kapanislar) >= 66 else None
            veri["perf_6ay"] = round(((guncel_fiyat - float(kapanislar.iloc[-132])) / float(kapanislar.iloc[-132])) * 100, 2) if len(kapanislar) >= 132 else None
            veri["perf_1yil"] = round(((guncel_fiyat - float(kapanislar.iloc[0])) / float(kapanislar.iloc[0])) * 100, 2)
        except Exception:
            veri["perf_1ay"] = veri["perf_3ay"] = veri["perf_6ay"] = veri["perf_1yil"] = None

    except Exception as e:
        print(f"Teknik veri hatasi: {e}")
        return None
    return veri


def temel_veri_cek(sembol):
    veri = {}
    try:
        hisse = yf.Ticker(sembol)
        bilgi = hisse.info
        if not bilgi:
            return {}

        veri["pe_orani"] = temizle_sayi(bilgi.get("trailingPE") or bilgi.get("forwardPE"))
        veri["pb_orani"] = temizle_sayi(bilgi.get("priceToBook"))
        veri["ev_ebitda"] = temizle_sayi(bilgi.get("enterpriseToEbitda"))
        veri["ev_gelir"] = temizle_sayi(bilgi.get("enterpriseToRevenue"))
        veri["peg_orani"] = temizle_sayi(bilgi.get("pegRatio"))

        veri["temettu_verimi"] = temizle_sayi(bilgi.get("dividendYield"))
        if veri["temettu_verimi"]:
            veri["temettu_verimi"] = round(veri["temettu_verimi"] * 100, 2)
        veri["odeme_orani"] = temizle_sayi(bilgi.get("payoutRatio"))
        if veri["odeme_orani"]:
            veri["odeme_orani"] = round(veri["odeme_orani"] * 100, 2)

        for alan, key in [("roe", "returnOnEquity"), ("roa", "returnOnAssets"),
                          ("ebitda_marji", "ebitdaMargins"), ("net_kar_marji", "profitMargins"),
                          ("brut_kar_marji", "grossMargins"), ("faaliyet_marji", "operatingMargins"),
                          ("gelir_buyumesi", "revenueGrowth"), ("kazanc_buyumesi", "earningsGrowth")]:
            v = temizle_sayi(bilgi.get(key))
            veri[alan] = round(v * 100, 2) if v else None

        veri["cari_oran"] = temizle_sayi(bilgi.get("currentRatio"))
        veri["asit_test"] = temizle_sayi(bilgi.get("quickRatio"))
        veri["borc_ozkaynak"] = temizle_sayi(bilgi.get("debtToEquity"))
        if veri["borc_ozkaynak"]:
            veri["borc_ozkaynak"] = round(veri["borc_ozkaynak"] / 100, 2)

        veri["piyasa_degeri"] = temizle_sayi(bilgi.get("marketCap"))
        veri["firma_degeri"] = temizle_sayi(bilgi.get("enterpriseValue"))
        veri["eps"] = temizle_sayi(bilgi.get("trailingEps"))
        veri["defter_degeri_hisse"] = temizle_sayi(bilgi.get("bookValue"))
        veri["serbest_nakit_akisi"] = temizle_sayi(bilgi.get("freeCashflow"))
        veri["toplam_borc"] = temizle_sayi(bilgi.get("totalDebt"))
        veri["nakit"] = temizle_sayi(bilgi.get("totalCash"))
        veri["gelir_ttm"] = temizle_sayi(bilgi.get("totalRevenue"))

        try:
            ebitda = temizle_sayi(bilgi.get("ebitda"))
            net_borc = (veri["toplam_borc"] or 0) - (veri["nakit"] or 0)
            veri["net_borc_ebitda"] = round(net_borc / ebitda, 2) if ebitda and ebitda != 0 else None
        except Exception:
            veri["net_borc_ebitda"] = None

        try:
            borc = temizle_sayi(bilgi.get("totalDebt")) or 0
            ozkaynak = temizle_sayi(bilgi.get("totalStockholderEquity")) or 0
            net_kar = temizle_sayi(bilgi.get("netIncomeToCommon")) or 0
            yatirilan = borc + ozkaynak
            veri["roic"] = round((net_kar / yatirilan) * 100, 2) if yatirilan > 0 else None
        except Exception:
            veri["roic"] = None

        veri["sektor"] = bilgi.get("sector", "Bilinmiyor")
        veri["sanayi"] = bilgi.get("industry", "Bilinmiyor")
        veri["sirket_adi"] = bilgi.get("longName") or bilgi.get("shortName", sembol)
        veri["ulke"] = bilgi.get("country", "Turkiye")
        veri["tanim"] = (bilgi.get("longBusinessSummary") or "")[:500]

    except Exception as e:
        print(f"Temel veri hatasi: {e}")
    return veri


def sektor_bul(sembol, yf_sektor):
    for sektor_adi, hisseler in SECTOR_PEERS.items():
        if sembol in hisseler:
            return sektor_adi
    if yf_sektor:
        yf_lower = yf_sektor.lower()
        for ing, tr in SEKTOR_MAP.items():
            if ing in yf_lower:
                return tr
    return None


def sektor_karsilastirma(sembol, yf_sektor):
    rakipler = []
    sektor_adi = sektor_bul(sembol, yf_sektor)
    if not sektor_adi or sektor_adi not in SECTOR_PEERS:
        return [], ""

    rakip_listesi = [r for r in SECTOR_PEERS[sektor_adi] if r != sembol]
    for rakip_sembol in rakip_listesi:
        try:
            bilgi = yf.Ticker(rakip_sembol).info
            if bilgi and bilgi.get("regularMarketPrice"):
                rakipler.append({
                    "sembol": rakip_sembol.replace(".IS", ""),
                    "sirket_adi": bilgi.get("shortName") or rakip_sembol.replace(".IS", ""),
                    "pe": temizle_sayi(bilgi.get("trailingPE")),
                    "pb": temizle_sayi(bilgi.get("priceToBook")),
                    "ev_ebitda": temizle_sayi(bilgi.get("enterpriseToEbitda")),
                    "roe": round(bilgi["returnOnEquity"] * 100, 2) if bilgi.get("returnOnEquity") else None,
                    "net_kar_marji": round(bilgi["profitMargins"] * 100, 2) if bilgi.get("profitMargins") else None,
                })
        except Exception as e:
            print(f"Rakip veri hatasi {rakip_sembol}: {e}")
    return rakipler, sektor_adi


def _haber_dict(baslik, kaynak, url="", tarih="", ozet="", baslik_tr=""):
    return {
        "baslik": baslik,
        "baslik_tr": baslik_tr or baslik,
        "sentiment_bireysel": "Notr",
        "kaynak": kaynak,
        "url": url,
        "tarih": tarih,
        "ozet": ozet,
    }


def keyword_sentiment(baslik):
    baslik_lower = baslik.lower()
    poz = sum(1 for k in POZITIF_KELIMELER if k in baslik_lower)
    olum = sum(1 for k in OLUMSUZ_KELIMELER if k in baslik_lower)
    if poz > olum:
        return "Olumlu"
    elif olum > poz:
        return "Olumsuz"
    return "Notr"


def yfinance_haber_cek(sembol):
    haberler = []
    try:
        yf_haberler = yf.Ticker(sembol).news or []
        for h in yf_haberler[:8]:
            content = h.get("content", {})
            provider = content.get("provider", {}) if isinstance(content, dict) else {}
            baslik = h.get("title") or (content.get("title") if isinstance(content, dict) else "") or ""
            if not baslik:
                continue
            url = h.get("link") or (content.get("canonicalUrl", {}).get("url") if isinstance(content, dict) else "") or ""
            kaynak = provider.get("displayName") or h.get("publisher", "")
            tarih = ""
            if h.get("providerPublishTime"):
                try:
                    tarih = datetime.fromtimestamp(h["providerPublishTime"]).strftime("%d.%m.%Y %H:%M")
                except Exception:
                    pass
            ozet = (content.get("summary") if isinstance(content, dict) else "") or ""
            haberler.append(_haber_dict(baslik, kaynak or "Yahoo Finance", url, tarih, ozet))
    except Exception as e:
        print(f"yfinance haber hatasi: {e}")
    return haberler


def google_news_cek(sembol, sirket_adi):
    haberler = []
    try:
        sembol_kisa = sembol.replace(".IS", "")
        yedi_gun_once = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
        arama = requests.utils.quote(f"{sembol_kisa} {sirket_adi} hisse after:{yedi_gun_once}")
        url = f"https://news.google.com/rss/search?q={arama}&hl=tr&gl=TR&ceid=TR:tr"
        yanit = requests.get(url, headers=HTTP_HEADERS, timeout=8)
        if yanit.status_code != 200:
            return haberler

        root = ET.fromstring(yanit.content)
        channel = root.find("channel")
        if channel is None:
            return haberler

        for item in channel.findall("item")[:8]:
            baslik = item.findtext("title") or ""
            if not baslik:
                continue
            link = item.findtext("link") or ""
            pub_date = item.findtext("pubDate") or ""
            kaynak_el = item.find("source")
            kaynak = kaynak_el.text if kaynak_el is not None else "Google Haberler"
            tarih = ""
            if pub_date:
                try:
                    tarih = parsedate_to_datetime(pub_date).strftime("%d.%m.%Y %H:%M")
                except Exception:
                    tarih = pub_date[:10]
            haberler.append(_haber_dict(baslik, kaynak, link, tarih))
    except Exception as e:
        print(f"Google News hatasi: {e}")
    return haberler


def kap_haber_cek(sembol):
    haberler = []
    try:
        sembol_kisa = sembol.replace(".IS", "")
        liste_url = "https://www.kap.org.tr/tr/api/memberCompanies/"
        yanit = requests.get(liste_url, headers=HTTP_HEADERS, timeout=10)
        if yanit.status_code != 200:
            return haberler

        sirketler = yanit.json()
        member_oid = None
        for sirket in sirketler:
            ticker = sirket.get("ticker") or ""
            if sembol_kisa.upper() == ticker.upper() or sembol_kisa.upper() in ticker.upper():
                member_oid = sirket.get("memberOid")
                break

        if not member_oid:
            return haberler

        bildirim_url = f"https://www.kap.org.tr/tr/api/disclosures/member/{member_oid}/limit/10"
        bildirim_yanit = requests.get(bildirim_url, headers=HTTP_HEADERS, timeout=10)
        if bildirim_yanit.status_code != 200:
            return haberler

        bildirimler = bildirim_yanit.json()
        for b in bildirimler[:10]:
            baslik = (b.get("title") or b.get("disclosureType") or b.get("subject") or "KAP Bildirimi").strip()
            tarih_raw = b.get("publishDate") or b.get("date") or ""
            tarih = ""
            if tarih_raw:
                try:
                    tarih = datetime.strptime(str(tarih_raw)[:19], "%Y-%m-%dT%H:%M:%S").strftime("%d.%m.%Y %H:%M")
                except Exception:
                    tarih = str(tarih_raw)[:10]
            bid_id = b.get("id") or b.get("disclosureIndex") or ""
            url = f"https://www.kap.org.tr/tr/Bildirim/{bid_id}" if bid_id else "https://www.kap.org.tr"
            haberler.append({
                "baslik": baslik,
                "baslik_tr": baslik,
                "sentiment_bireysel": "Notr",
                "kaynak": "KAP",
                "url": url,
                "tarih": tarih,
                "ozet": b.get("subject") or "",
            })
    except Exception as e:
        print(f"KAP haber hatasi: {e}")
    return haberler


def haber_cek(sembol, sirket_adi):
    tum_haberler = []
    seen = set()

    for kaynak_fn in [lambda: kap_haber_cek(sembol),
                      lambda: google_news_cek(sembol, sirket_adi),
                      lambda: yfinance_haber_cek(sembol)]:
        try:
            for h in kaynak_fn():
                key = h["baslik"][:60]
                if key not in seen:
                    seen.add(key)
                    tum_haberler.append(h)
        except Exception as e:
            print(f"Haber hatasi: {e}")

    return tum_haberler[:12]


def haber_cevir_ve_sentiment(haberler, sirket_adi):
    if not haberler:
        return haberler
    for h in haberler:
        if not h.get("baslik_tr"):
            h["baslik_tr"] = h["baslik"]
        h["sentiment_bireysel"] = keyword_sentiment(h.get("baslik_tr") or h.get("baslik", ""))
    return haberler


def genel_sentiment_hesapla(haberler):
    olumlu = sum(1 for h in haberler if h.get("sentiment_bireysel") == "Olumlu")
    olumsuz = sum(1 for h in haberler if h.get("sentiment_bireysel") == "Olumsuz")
    if olumlu > olumsuz:
        return "Olumlu"
    elif olumsuz > olumlu:
        return "Olumsuz"
    return "Notr"


def yedek_degerlendirme_hesapla(teknik, temel):
    puan = 50
    pozitif = []
    riskler = []

    rsi = teknik.get("rsi") if teknik else None
    if rsi:
        if rsi < 30:
            puan += 15; pozitif.append(f"RSI {rsi:.0f} — asiri satim bolgesi, teknik geri donus potansiyeli")
        elif rsi < 45:
            puan += 7; pozitif.append(f"RSI {rsi:.0f} — dusuk seviyede, alim firsati sinyali")
        elif rsi > 70:
            puan -= 15; riskler.append(f"RSI {rsi:.0f} — asiri alim bolgesi, kisa vadeli duzeltme riski")
        elif rsi > 60:
            puan -= 5; riskler.append(f"RSI {rsi:.0f} — yuksek seviyelerde seyrediyor")

    if teknik:
        ma_yukarida = sum(1 for d in [teknik.get("ma20_durum"), teknik.get("ma50_durum"), teknik.get("ma200_durum")] if d == "Üzerinde")
        if ma_yukarida == 3:
            puan += 12; pozitif.append("Fiyat 20/50/200 gunluk ortalamalarin uzerinde — guclu yukselis trendi")
        elif ma_yukarida == 2:
            puan += 6; pozitif.append(f"Fiyat {ma_yukarida} hareketli ortalamanin uzerinde — pozitif trend")
        elif ma_yukarida == 0:
            puan -= 12; riskler.append("Fiyat tum hareketli ortalamalarin altinda — dusus trendi")

        if teknik.get("macd_histogram"):
            if teknik["macd_histogram"] > 0:
                puan += 5; pozitif.append("MACD histogrami pozitif — yukselis momentumu devam ediyor")
            else:
                puan -= 5; riskler.append("MACD histogrami negatif — dusus baskisi mevcut")

    pe = temel.get("pe_orani") if temel else None
    if pe and pe > 0:
        if pe < 8:
            puan += 12; pozitif.append(f"F/K {pe:.1f}x — sektore gore cok ucuz")
        elif pe < 15:
            puan += 6; pozitif.append(f"F/K {pe:.1f}x — makul degerleme")
        elif pe > 35:
            puan -= 10; riskler.append(f"F/K {pe:.1f}x — yuksek prim")
        elif pe > 25:
            puan -= 5; riskler.append(f"F/K {pe:.1f}x — ortalama ustu degerleme")

    pb = temel.get("pb_orani") if temel else None
    if pb and pb > 0:
        if pb < 1:
            puan += 10; pozitif.append(f"PD/DD {pb:.2f}x — defter degerinin altinda")
        elif pb > 5:
            puan -= 8; riskler.append(f"PD/DD {pb:.2f}x — defter degerine gore yuksek prim")

    roe = temel.get("roe") if temel else None
    if roe:
        if roe > 20:
            puan += 10; pozitif.append(f"ROE %{roe:.0f} — ustun ozsermaye karliligi")
        elif roe > 10:
            puan += 4; pozitif.append(f"ROE %{roe:.0f} — tatmin edici ozsermaye getirisi")
        elif roe < 0:
            puan -= 12; riskler.append(f"ROE %{roe:.0f} — negatif ozsermaye karliligi")

    borc = temel.get("borc_ozkaynak") if temel else None
    if borc:
        if borc > 2:
            puan -= 10; riskler.append(f"Borc/Ozkaynak {borc:.2f}x — yuksek kaldirac")
        elif borc < 0.5:
            puan += 8; pozitif.append(f"Borc/Ozkaynak {borc:.2f}x — guclu bilanco")

    puan = max(5, min(95, puan))

    if puan >= 75:
        tavsiye, tavsiye_renk = "GUCLU AL", "guclu-al"
    elif puan >= 60:
        tavsiye, tavsiye_renk = "AL", "al"
    elif puan >= 45:
        tavsiye, tavsiye_renk = "TUT", "tut"
    elif puan >= 30:
        tavsiye, tavsiye_renk = "SAT", "sat"
    else:
        tavsiye, tavsiye_renk = "GUCLU SAT", "guclu-sat"

    return {"tavsiye": tavsiye, "tavsiye_renk": tavsiye_renk, "puan": puan, "pozitif": pozitif[:3], "riskler": riskler[:3]}


def ai_analiz_olustur(sembol, teknik, temel, rakipler, haberler, sektor_adi):
    sirket_adi = temel.get("sirket_adi", sembol)
    sentiment = genel_sentiment_hesapla(haberler)

    haber_ozeti = "\n".join([
        f"- {h.get('baslik_tr') or h.get('baslik', '')} -> {h.get('sentiment_bireysel', 'Notr')} ({h.get('kaynak', '')})"
        for h in haberler[:6]
    ]) or "Haber bulunamadi"

    rakip_ozeti = ""
    if rakipler:
        rakip_ozeti = f"Sektor ({sektor_adi}) rakipleri:\n"
        for r in rakipler:
            rakip_ozeti += f"- {r['sembol']}: F/K={r.get('pe','N/A')}, PD/DD={r.get('pb','N/A')}, ROE=%{r.get('roe','N/A')}\n"

    prompt = f"""Asagida {sirket_adi} ({sembol}) hissesine ait kapsamli finansal veriler var. Profesyonel bir yatirim raporu hazirla.

## TEKNIK VERILER
- Guncel Fiyat: {teknik.get('guncel_fiyat','N/A')} TL | Gunluk Degisim: %{teknik.get('gunluk_degisim','N/A')}
- RSI (14): {teknik.get('rsi','N/A')} | MACD: {teknik.get('macd','N/A')}
- MA20/50/200: {teknik.get('ma20','N/A')}/{teknik.get('ma50','N/A')}/{teknik.get('ma200','N/A')}
- Destek/Direnc: {teknik.get('destek','N/A')}/{teknik.get('direnc','N/A')} TL
- Perf 1A/3A/1Y: %{teknik.get('perf_1ay','N/A')}/%{teknik.get('perf_3ay','N/A')}/%{teknik.get('perf_1yil','N/A')}

## TEMEL VERILER
- F/K: {temel.get('pe_orani','N/A')} | PD/DD: {temel.get('pb_orani','N/A')} | FD/FAVOK: {temel.get('ev_ebitda','N/A')}
- ROE: %{temel.get('roe','N/A')} | Net Marj: %{temel.get('net_kar_marji','N/A')}
- Borc/Oz: {temel.get('borc_ozkaynak','N/A')} | Piyasa Degeri: {format_buyuk_sayi(temel.get('piyasa_degeri'))}
- Sektor: {sektor_adi or temel.get('sektor','N/A')}

## SEKTOR KARSILASTIRMASI
{rakip_ozeti or "Veri yok"}

## HABERLER (Genel Duygu: {sentiment})
{haber_ozeti}

Asagidaki basliklarla analiz yaz:

## Teknik Analiz
## Temel Analiz
## Bilanco Sagligi
## Sektor Pozisyonu
## Haber Analizi
## Yatirim Tavsiyesi (GUCLU AL / AL / TUT / SAT / GUCLU SAT, hedef fiyat, riskler)"""

    try:
        mesaj = client.messages.create(
            model=CLAUDE_MODEL, max_tokens=2000, timeout=60.0,
            system="Sen uzman bir Turk borsa analistisin. Yanitinin tamamen Turkce olsun.",
            messages=[{"role": "user", "content": prompt}]
        )
        return mesaj.content[0].text
    except Exception as e:
        print(f"AI analiz hatasi: {e}")
        return None


@app.route("/")
def anasayfa():
    return render_template("index.html")


@app.route("/analyze", methods=["POST"])
def analiz_et():
    sembol_ham = request.form.get("sembol", "").strip()
    if not sembol_ham:
        return render_template("index.html", hata="Lutfen bir hisse sembolu girin.")

    sembol = sembol_duzenle(sembol_ham)
    teknik = temel = rakipler = haberler = ai_raporu = yedek_degerlendirme = None
    sektor_adi = ""
    temel = {}

    try:
        teknik = teknik_veri_cek(sembol)
        if teknik is None:
            return render_template("index.html", hata=f"Hisse bulunamadi: {sembol.replace('.IS','')}. Sembolu kontrol edin.")

        temel = temel_veri_cek(sembol)

        try:
            sonuc = sektor_karsilastirma(sembol, temel.get("sektor", ""))
            if sonuc:
                rakipler, sektor_adi = sonuc
        except Exception as e:
            print(f"Sektor hatasi: {e}")

        sirket_adi = temel.get("sirket_adi", sembol.replace(".IS", ""))

        try:
            haberler = haber_cek(sembol, sirket_adi)
        except Exception as e:
            print(f"Haber hatasi: {e}")
            haberler = []

        try:
            if haberler:
                haberler = haber_cevir_ve_sentiment(haberler, sirket_adi)
        except Exception as e:
            print(f"Sentiment hatasi: {e}")

        yedek_degerlendirme = yedek_degerlendirme_hesapla(teknik, temel)

        try:
            ai_raporu = ai_analiz_olustur(sembol, teknik, temel, rakipler or [], haberler or [], sektor_adi)
        except Exception as e:
            print(f"AI hatasi: {e}")
            ai_raporu = None

    except Exception as e:
        return render_template("index.html", hata=f"Hata: {str(e)}")

    return render_template(
        "analysis.html",
        sembol=sembol.replace(".IS", ""),
        sirket_adi=temel.get("sirket_adi", sembol),
        teknik=teknik,
        temel=temel,
        rakipler=rakipler or [],
        sektor_adi=sektor_adi,
        haberler=haberler or [],
        ai_raporu=ai_raporu,
        yedek_degerlendirme=yedek_degerlendirme,
        sentiment=genel_sentiment_hesapla(haberler or []),
        format_buyuk_sayi=format_buyuk_sayi,
        analiz_tarihi=datetime.now().strftime("%d.%m.%Y %H:%M"),
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
