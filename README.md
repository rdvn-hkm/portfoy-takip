# Vault — Portföy Takip Paneli

Kişisel portföy takip panelinin (`index.html` + `app.js`) ve fiyat
güncelleme rutininin (`scripts/update_prices.py`) kaynak kodu.

## Dosyalar

- `index.html` — panelin HTML iskeleti + `#portfolio-data` script bloğu
  (holdings, fiyatlar, son güncelleme zamanı, AI yorumu). Tarayıcıda
  doğrudan açılabilir.
- `app.js` — panelin render mantığı (React/derleme yok, saf JS).
- `scripts/update_prices.py` — Alpha Vantage'dan fiyat çeker,
  `index.html` içindeki veri bloğunu günceller, git'e commit+push
  eder ve Telegram'a bildirim gönderir.
- `.env` — API anahtarları (git'e commit edilmez, bkz. `.env.example`).

## Fiyat kaynakları

| Varlık türü        | Kaynak                                   | Güncelleme      |
|---------------------|-------------------------------------------|-----------------|
| ABD hisseleri (AAPL, MSFT, NVDA) | Alpha Vantage (`GLOBAL_QUOTE`)      | zamanlanmış rutin (8 saatte bir) |
| BTC, ETH             | Alpha Vantage (`CURRENCY_EXCHANGE_RATE`)  | zamanlanmış rutin |
| EUR/USD              | Alpha Vantage (`CURRENCY_EXCHANGE_RATE`)  | zamanlanmış rutin |
| Altın (XAU/USD)      | Alpha Vantage (`CURRENCY_EXCHANGE_RATE`)  | zamanlanmış rutin |
| USD/TRY (BIST için)  | Alpha Vantage (`CURRENCY_EXCHANGE_RATE`)  | zamanlanmış rutin |
| BTC/ETH/EURUSD (tarayıcıda "Fiyatları Güncelle") | CoinGecko + open.er-api.com (ücretsiz) | manuel, anlık |
| THYAO, ASELS (BIST)  | **Alpha Vantage'da yok** — demo/jitter fiyat | — |
| GTF (fon)            | Gerçek kaynak yok — demo/jitter fiyat     | — |

**Neden 8 saatte bir?** Alpha Vantage ücretsiz anahtar günde 25 istek,
saniyede 1 istekle sınırlı. Bu script tek çalıştırmada 8 istek harcar
(3 hisse + BTC + ETH + EURUSD + XAU/USD + USD/TRY). Saatlik çalıştırma
günde 192 istek gerektirir ve limiti aşar; 8 saatte bir (günde 3 kez)
24 istekle limitin altında kalır.

## Yerel çalıştırma

```bash
cp .env.example .env   # ve gerçek key'leri girin
python3 scripts/update_prices.py
```

Script yalnızca stdlib kullanır (ekstra `pip install` gerekmez).

## Zamanlanmış rutin

Fiyat güncellemesi Claude Code'un bulut rutini (schedule/CronCreate)
üzerinden her 8 saatte bir otomatik çalışır: repoyu çeker, scripti
çalıştırır, portföydeki dikkat çekici hareketler için kısa bir AI
yorumu üretip `aiNote` alanına yazar, commit+push eder ve Telegram'a
bildirim gönderir. Rutin claude.ai/code/routines üzerinden yönetilir.

## Pozisyon senkronizasyonu (GitHub)

Pozisyon kompozisyonu (miktar/ortalama maliyet/nakit) varsayılan olarak
tarayıcı localStorage'ında tutulur ve bu cihaza özeldir — zamanlanmış
rutin bu veriyi göremez, sadece `index.html`'deki son push edilmiş
`holdings` listesini baz alır (fiyat çekimi ve AI tavsiye/fırsat
raporları için sembol kaynağı budur).

Bu ikisini eşitlemek için panelde bir GitHub senkronizasyon anahtarı
girilebilir (sağ üstteki durum göstergesine tıklayın): girildiğinde her
pozisyon ekleme/çıkarma/miktar-maliyet/nakit değişikliğinde, tarayıcı
GitHub Contents API üzerinden `index.html` içindeki `holdings` ve
`cash` alanlarını doğrudan bu repoya commit eder. Böylece rutinin
analiz ettiği liste her zaman "Varlıklarım" ekranındakiyle aynı olur.

Kullanılacak token, sadece bu repoya (`Contents: Read and write`)
izinli **fine-grained personal access token** olmalı — repo geneli
yazma izni olan klasik bir PAT kullanmayın, token tarayıcıda
localStorage'da saklanır ve asla git'e commit edilmez.
