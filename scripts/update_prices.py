#!/usr/bin/env python3
"""
Alpha Vantage'dan güncel fiyatları çekip index.html içindeki
#portfolio-data JSON bloğunu günceller, git'e commit+push eder ve
Telegram'a "veriler güncellendi" bildirimi gönderir.

Kullanım:
    python3 scripts/update_prices.py

Gerekli ortam değişkenleri (repo kökündeki .env dosyasından ya da
ortamdan okunur, .env asla git'e commit edilmez):
    ALPHAVANTAGE_API_KEY
    TELEGRAM_BOT_TOKEN
    TELEGRAM_CHAT_ID

Sembol listesi DİNAMİKTİR: index.html'deki mevcut holdings dizisinde
hangi US/Crypto/Forex/Gold tipi semboller varsa onlar çekilir (BIST ve
Fund, Alpha Vantage kapsamı dışında olduğu SYMBOL_SEARCH ile doğrulandığı
için hariç tutulur). Baseline'a yeni bir ABD hissesi/kripto eklenirse
script otomatik uyum sağlar.

Alpha Vantage ücretsiz anahtar limiti: günde 25 istek, saniyede 1 istek.
Her sembol/kur 1 istek harcar + USD/TRY için 1 istek daha. Mevcut 10
varlıklı baseline'da (3 ABD hissesi + BTC + ETH + EURUSD + XAU + USD/TRY)
bu 8 istek eder — bu yüzden zamanlanmış rutin günde 3 kezden (8 saatte
bir) daha sık çalıştırılmamalı. Baseline'a yeni sembol eklenirse istek
sayısı da artar; toplamın günde 25'i (ya da rutin sıklığına göre daha
azını) aşmadığından emin olun.
"""
import json
import os
import re
import ssl
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_HTML = os.path.join(ROOT, "index.html")
ENV_FILE = os.path.join(ROOT, ".env")

AV_BASE = "https://www.alphavantage.co/query"
REQUEST_DELAY = 1.1  # Alpha Vantage: saniyede 1 istek limiti

# Alpha Vantage'da GERÇEKTEN karşılığı olduğu doğrulanan tipler.
# BIST: SYMBOL_SEARCH boş döndü (kapsam dışı). Fund: gerçek bir ticker
# değil, kurumsal veri kaynağımız yok.
LIVE_TYPES = {"US", "Crypto", "Forex", "Gold"}


def build_ssl_context():
    """Homebrew/python.org Python kurulumlarında CA sertifika paketi
    sisteme bağlı olmayabilir (certifi de yoksa urlopen SSL doğrulama
    hatası verir). macOS'un sistem kök sertifika paketini deneyip, yoksa
    varsayılan bağlama düşer (ör. Linux konteynerlerinde zaten çalışır)."""
    for path in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
        if os.path.exists(path):
            try:
                return ssl.create_default_context(cafile=path)
            except Exception:
                pass
    return ssl.create_default_context()


SSL_CONTEXT = build_ssl_context()


def load_env():
    """.env dosyasını (varsa) mevcut ortamı ezmeden yükler."""
    if not os.path.exists(ENV_FILE):
        return
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


def av_get(params, api_key):
    params = dict(params)
    params["apikey"] = api_key
    url = AV_BASE + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=20, context=SSL_CONTEXT) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if "Information" in data or "Note" in data or "Error Message" in data:
        raise RuntimeError(data.get("Information") or data.get("Note") or data.get("Error Message"))
    return data


def fetch_stock_quote(symbol, api_key):
    """(fiyat, önceki_kapanış) döner."""
    data = av_get({"function": "GLOBAL_QUOTE", "symbol": symbol}, api_key)
    quote = data.get("Global Quote") or {}
    price = quote.get("05. price")
    prev_close = quote.get("08. previous close")
    if not price:
        raise RuntimeError(f"{symbol}: fiyat alanı boş döndü")
    return float(price), float(prev_close) if prev_close else float(price)


def fetch_exchange_rate(from_ccy, to_ccy, api_key):
    data = av_get({
        "function": "CURRENCY_EXCHANGE_RATE",
        "from_currency": from_ccy,
        "to_currency": to_ccy,
    }, api_key)
    rate = (data.get("Realtime Currency Exchange Rate") or {}).get("5. Exchange Rate")
    if not rate:
        raise RuntimeError(f"{from_ccy}/{to_ccy}: kur alanı boş döndü")
    return float(rate)


def load_portfolio_data(html):
    m = re.search(
        r'(<script type="application/json" id="portfolio-data">\n)(.*?)(\n</script>)',
        html, re.S,
    )
    if not m:
        raise RuntimeError("index.html içinde #portfolio-data bloğu bulunamadı")
    return json.loads(m.group(2)), m


def save_portfolio_data(html, match, data):
    serialized = json.dumps(data, ensure_ascii=False, indent=2)
    serialized = serialized.replace("</script", "<\\/script")
    return html[:match.start()] + match.group(1) + serialized + match.group(3) + html[match.end():]


def upsert_history(holding, today, price):
    history = holding.setdefault("priceHistory", [])
    for entry in history:
        if entry["date"] == today:
            entry["price"] = price
            return
    history.append({"date": today, "price": price})
    history.sort(key=lambda e: e["date"])


def git(*args, check=True):
    return subprocess.run(["git", "-C", ROOT, *args], check=check,
                           capture_output=True, text=True)


def send_telegram(token, chat_id, text):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": text,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST")
    with urllib.request.urlopen(req, timeout=20, context=SSL_CONTEXT) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    if not result.get("ok"):
        raise RuntimeError(f"Telegram gönderimi başarısız: {result}")


def main():
    load_env()
    api_key = os.environ.get("ALPHAVANTAGE_API_KEY")
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not api_key:
        sys.exit("ALPHAVANTAGE_API_KEY tanımlı değil (.env veya ortam değişkeni)")

    with open(INDEX_HTML, encoding="utf-8") as f:
        html = f.read()
    data, match = load_portfolio_data(html)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    updated, failed = [], []

    def try_fetch(label, fn):
        try:
            value = fn()
            updated.append(label)
            return value
        except Exception as exc:
            print(f"[uyarı] {label} alınamadı: {exc}", file=sys.stderr)
            failed.append(label)
            return None
        finally:
            time.sleep(REQUEST_DELAY)

    for holding in data["holdings"]:
        symbol = holding["symbol"]
        htype = holding.get("type")
        if htype not in LIVE_TYPES:
            continue  # BIST / Fund: Alpha Vantage kapsamı dışı, demo kalır

        if htype == "US":
            result = try_fetch(symbol, lambda s=symbol: fetch_stock_quote(s, api_key))
            if result is not None:
                price, prev_close = result
                holding["price"] = price
                holding["prevClose"] = prev_close
                holding["source"] = "live"
                upsert_history(holding, today, price)
        elif htype == "Crypto":
            prev_price = holding.get("price") or None
            price = try_fetch(f"{symbol}/USD", lambda s=symbol: fetch_exchange_rate(s, "USD", api_key))
            if price is not None:
                holding["prevClose"] = prev_price if prev_price else price
                holding["price"] = price
                holding["source"] = "live"
                upsert_history(holding, today, price)
        elif htype == "Forex":
            # "EURUSD" gibi birleşik semboller varsayılan olarak from=ilk3/to=son3
            from_ccy, to_ccy = (symbol[:3], symbol[3:]) if len(symbol) == 6 else (symbol, "USD")
            prev_price = holding.get("price") or None
            price = try_fetch(f"{from_ccy}/{to_ccy}", lambda f=from_ccy, t=to_ccy: fetch_exchange_rate(f, t, api_key))
            if price is not None:
                holding["prevClose"] = prev_price if prev_price else price
                holding["price"] = price
                holding["source"] = "live"
                upsert_history(holding, today, price)
        elif htype == "Gold":
            prev_price = holding.get("price") or None
            price = try_fetch(f"{symbol}/USD (emtia)", lambda s=symbol: fetch_exchange_rate(s, "USD", api_key))
            if price is not None:
                holding["prevClose"] = prev_price if prev_price else price
                holding["price"] = price
                holding["source"] = "live"
                upsert_history(holding, today, price)

    usd_try = try_fetch("USD/TRY", lambda: fetch_exchange_rate("USD", "TRY", api_key))
    if usd_try is not None:
        data["usdTryRate"] = usd_try

    eurusd_holding = next((h for h in data["holdings"] if h["symbol"] == "EURUSD"), None)
    if eurusd_holding:
        data["eurUsdRate"] = eurusd_holding["price"]

    data["lastUpdated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    new_html = save_portfolio_data(html, match, data)
    with open(INDEX_HTML, "w", encoding="utf-8") as f:
        f.write(new_html)

    diff = git("diff", "--quiet", "--", "index.html", check=False)
    committed = False
    if diff.returncode != 0:
        git("add", "index.html")
        git("commit", "-m", f"chore: fiyatları güncelle ({data['lastUpdated']})")
        push = git("push", check=False)
        if push.returncode != 0:
            print(f"[uyarı] git push başarısız: {push.stderr}", file=sys.stderr)
        committed = True

    summary_lines = [
        "✅ Portföy verileri güncellendi",
        f"Zaman: {data['lastUpdated']}",
    ]
    if updated:
        summary_lines.append("Güncellenen: " + ", ".join(updated))
    if failed:
        summary_lines.append("Alınamayan (limit/kapsam dışı): " + ", ".join(failed))
    if not committed:
        summary_lines.append("(Not: fiyatlarda değişiklik yok, commit atlandı)")
    summary = "\n".join(summary_lines)
    print(summary)

    if bot_token and chat_id:
        try:
            send_telegram(bot_token, chat_id, summary)
        except Exception as exc:
            print(f"[uyarı] Telegram bildirimi gönderilemedi: {exc}", file=sys.stderr)
    else:
        print("[uyarı] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID tanımlı değil, bildirim atlandı", file=sys.stderr)


if __name__ == "__main__":
    main()
