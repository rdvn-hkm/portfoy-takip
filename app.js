// Portföy Takip Paneli
// Fiyat verisi: index.html içindeki #portfolio-data (scripts/update_prices.py
// ve zamanlanmış bulut rutini tarafından güncellenir).
// Pozisyon kompozisyonu (miktar/ortalama maliyet/nakit/profil): tarayıcı
// localStorage'ında tutulur — bu yüzden bu cihaza özeldir. GitHub token
// tanımlıysa her değişiklikte index.html'deki holdings/cash otomatik olarak
// GitHub'a commit edilir, böylece rutin de aynı listeyi görür (bkz. GITHUB_*
// sabitleri ve syncHoldingsToGitHub).

(function () {
  const STORAGE_KEY = 'vault_portfolio_v1';
  const GITHUB_TOKEN_KEY = 'vault_github_token';
  const GITHUB_OWNER = 'rdvn-hkm';
  const GITHUB_REPO = 'portfoy-takip';
  const GITHUB_BRANCH = 'main';
  const GITHUB_PATH = 'index.html';

  const TYPE_META = {
    US: { label: 'ABD Hissesi', category: 'ABD Hisseleri', color: '#60a5fa' },
    BIST: { label: 'BIST Hissesi', category: 'BIST Hisseleri', color: '#2dd4bf' },
    Crypto: { label: 'Kripto', category: 'Kripto', color: '#fbbf24' },
    Forex: { label: 'Döviz', category: 'Döviz', color: '#a78bfa' },
    Gold: { label: 'Altın', category: 'Altın', color: '#eab308' },
    Fund: { label: 'Fon', category: 'Fon', color: '#f472b6' },
    Other: { label: 'Diğer', category: 'Diğer', color: '#9ca3af' }
  };

  // Pozisyon Ekle'de otomatik ad/tür doldurma için sabit katalog (API çağrısı
  // yapmaz — Alpha Vantage kotasını korumak için bilinçli olarak client-side
  // ve statik). Listede olmayan bir sembol de elle eklenebilir (tür/ad
  // manuel seçilir).
  const SYMBOL_CATALOG = [
    ['AAPL', 'Apple Inc.', 'US'], ['MSFT', 'Microsoft Corp.', 'US'], ['NVDA', 'NVIDIA Corp.', 'US'],
    ['AMZN', 'Amazon.com Inc.', 'US'], ['GOOGL', 'Alphabet Inc.', 'US'], ['META', 'Meta Platforms Inc.', 'US'],
    ['TSLA', 'Tesla Inc.', 'US'], ['AVGO', 'Broadcom Inc.', 'US'], ['LLY', 'Eli Lilly', 'US'],
    ['CRM', 'Salesforce Inc.', 'US'], ['XOM', 'ExxonMobil', 'US'], ['JPM', 'JPMorgan Chase', 'US'],
    ['V', 'Visa Inc.', 'US'], ['MA', 'Mastercard Inc.', 'US'], ['WMT', 'Walmart Inc.', 'US'],
    ['DIS', 'Walt Disney Co.', 'US'], ['NFLX', 'Netflix Inc.', 'US'], ['ORCL', 'Oracle Corp.', 'US'],
    ['ADBE', 'Adobe Inc.', 'US'], ['AMD', 'Advanced Micro Devices', 'US'], ['INTC', 'Intel Corp.', 'US'],
    ['KO', 'Coca-Cola Co.', 'US'], ['PEP', 'PepsiCo Inc.', 'US'], ['NKE', 'Nike Inc.', 'US'],
    ['BA', 'Boeing Co.', 'US'], ['IBM', 'IBM Corp.', 'US'], ['CSCO', 'Cisco Systems', 'US'],
    ['QCOM', 'Qualcomm Inc.', 'US'], ['PYPL', 'PayPal Holdings', 'US'], ['UBER', 'Uber Technologies', 'US'],
    ['THYAO', 'Türk Hava Yolları', 'BIST'], ['ASELS', 'Aselsan', 'BIST'], ['SASA', 'Sasa Polyester', 'BIST'],
    ['KCHOL', 'Koç Holding', 'BIST'], ['EREGL', 'Erdemir', 'BIST'], ['TUPRS', 'Tüpraş', 'BIST'],
    ['GARAN', 'Garanti BBVA', 'BIST'], ['AKBNK', 'Akbank', 'BIST'], ['BIMAS', 'BİM', 'BIST'],
    ['SISE', 'Şişe Cam', 'BIST'], ['FROTO', 'Ford Otosan', 'BIST'], ['TOASO', 'Tofaş', 'BIST'],
    ['PGSUS', 'Pegasus', 'BIST'], ['KOZAL', 'Koza Altın', 'BIST'], ['SAHOL', 'Sabancı Holding', 'BIST'],
    ['YKBNK', 'Yapı Kredi', 'BIST'], ['TCELL', 'Turkcell', 'BIST'], ['ARCLK', 'Arçelik', 'BIST'],
    ['BTC', 'Bitcoin', 'Crypto'], ['ETH', 'Ethereum', 'Crypto'], ['SOL', 'Solana', 'Crypto'],
    ['XRP', 'Ripple', 'Crypto'], ['ADA', 'Cardano', 'Crypto'], ['DOGE', 'Dogecoin', 'Crypto'],
    ['BNB', 'Binance Coin', 'Crypto'],
    ['EURUSD', 'Euro / Amerikan Doları', 'Forex'], ['USDTRY', 'Amerikan Doları / Türk Lirası', 'Forex'],
    ['GBPUSD', 'İngiliz Sterlini / Amerikan Doları', 'Forex'], ['USDJPY', 'Amerikan Doları / Japon Yeni', 'Forex'],
    ['XAU', 'Altın (ons)', 'Gold'], ['XAG', 'Gümüş (ons)', 'Gold']
  ].map(([symbol, name, type]) => ({ symbol, name, type }));

  const CURRENCIES = {
    USD: { label: 'USD', symbol: '$' },
    TRY: { label: 'TRY', symbol: '₺' },
    EUR: { label: 'EUR', symbol: '€' }
  };

  // ---------- helpers ----------
  function seededFactor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return (h % 1000) / 1000;
  }
  function fmt(n, opts) {
    opts = opts || {};
    const sign = n < 0 ? '-' : '';
    return sign + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: opts.digits ?? 2, maximumFractionDigits: opts.digits ?? 2 });
  }
  function fmtPct(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    const sign = n >= 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function stdev(arr) {
    if (arr.length < 2) return null;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
    return Math.sqrt(v);
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function yearStartISO() { return new Date().getFullYear() + '-01-01'; }
  function daysAgoISO(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

  // ---------- baseline (from index.html, server/rutin owned) ----------
  const baseline = JSON.parse(document.getElementById('portfolio-data').textContent);
  const baselinePriceBySymbol = {};
  baseline.holdings.forEach(h => { baselinePriceBySymbol[h.symbol] = h; });

  // ---------- composition (localStorage owned) ----------
  function seedComposition() {
    return {
      holdings: baseline.holdings.map(h => ({ id: h.id, symbol: h.symbol, name: h.name, type: h.type, quantity: h.quantity, avgCost: h.avgCost })),
      cash: baseline.cash,
      profile: { name: 'Portföy Sahibi', subtitle: 'Kişisel Portföy' },
      prefs: { currency: 'USD' }
    };
  }
  function loadComposition() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seedComposition();
      const parsed = JSON.parse(raw);
      if (!parsed.holdings) return seedComposition();
      parsed.prefs = parsed.prefs || { currency: 'USD' };
      parsed.profile = parsed.profile || { name: 'Portföy Sahibi', subtitle: 'Kişisel Portföy' };
      return parsed;
    } catch (e) {
      return seedComposition();
    }
  }
  let composition = loadComposition();
  function saveComposition() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(composition));
  }

  // ---------- ephemeral UI state ----------
  const ui = {
    view: 'portfolio',
    searchQuery: '',
    typeFilter: 'all',
    showAddForm: false,
    editingProfile: false,
    editingCash: false,
    editingSync: false,
    addSelected: null, // {symbol,name,type} son seçilen katalog eşleşmesi
    syncStatus: getGithubToken() ? 'ready' : 'off', // off|ready|syncing|ok|error
    syncMessage: ''
  };

  // ---------- GitHub senkronizasyonu (composition -> index.html holdings) ----------
  function getGithubToken() {
    return localStorage.getItem(GITHUB_TOKEN_KEY) || '';
  }
  function setGithubToken(token) {
    if (token) localStorage.setItem(GITHUB_TOKEN_KEY, token);
    else localStorage.removeItem(GITHUB_TOKEN_KEY);
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }
  function base64ToUtf8(b64) {
    const binary = atob(b64.replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }

  // composition.holdings/cash'i verilen index.html içeriğindeki
  // #portfolio-data bloğuna uygular; fiyat/prevClose/priceHistory/source
  // alanlarını (rutin tarafından yönetilir) mevcut sembol eşleşmesi varsa
  // korur, yeni sembollere demo/boş değer atar, kompozisyonda olmayan
  // sembolleri baseline'dan çıkarır.
  function mergeCompositionIntoFileContent(fileContent) {
    const re = /(<script type="application\/json" id="portfolio-data">\n)([\s\S]*?)(\n<\/script>)/;
    const m = fileContent.match(re);
    if (!m) throw new Error('index.html içinde #portfolio-data bloğu bulunamadı');
    const data = JSON.parse(m[2]);
    const oldBySymbol = {};
    (data.holdings || []).forEach(h => { oldBySymbol[h.symbol] = h; });
    data.holdings = composition.holdings.map(c => {
      const old = oldBySymbol[c.symbol];
      if (old) return { ...old, id: c.id, symbol: c.symbol, name: c.name, type: c.type, quantity: c.quantity, avgCost: c.avgCost };
      return {
        id: c.id, symbol: c.symbol, name: c.name, type: c.type,
        quantity: c.quantity, avgCost: c.avgCost,
        price: 0, prevClose: 0, source: 'demo', priceHistory: []
      };
    });
    data.cash = composition.cash;
    const newBlock = JSON.stringify(data, null, 2);
    return fileContent.slice(0, m.index) + m[1] + newBlock + m[3] + fileContent.slice(m.index + m[0].length);
  }

  async function githubApi(path, options) {
    const token = getGithubToken();
    const res = await fetch('https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + path, {
      ...options,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options && options.headers)
      }
    });
    return res;
  }

  let syncTimer = null;
  function scheduleSync() {
    if (!getGithubToken()) { ui.syncStatus = 'off'; return; }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncHoldingsToGitHub, 1200);
    ui.syncStatus = 'syncing';
    render();
  }

  async function syncHoldingsToGitHub(retry) {
    if (!getGithubToken()) { ui.syncStatus = 'off'; render(); return; }
    ui.syncStatus = 'syncing';
    render();
    try {
      const getRes = await githubApi('/contents/' + GITHUB_PATH + '?ref=' + GITHUB_BRANCH, {});
      if (!getRes.ok) throw new Error('GitHub okuma hatası: ' + getRes.status);
      const getData = await getRes.json();
      const oldContent = base64ToUtf8(getData.content);
      const newContent = mergeCompositionIntoFileContent(oldContent);
      const putRes = await githubApi('/contents/' + GITHUB_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'chore: portföy pozisyonlarını senkronize et',
          content: utf8ToBase64(newContent),
          sha: getData.sha,
          branch: GITHUB_BRANCH
        })
      });
      if (putRes.status === 409 && !retry) {
        return syncHoldingsToGitHub(true);
      }
      if (!putRes.ok) {
        const body = await putRes.json().catch(() => ({}));
        throw new Error('GitHub yazma hatası: ' + putRes.status + ' ' + (body.message || ''));
      }
      ui.syncStatus = 'ok';
      ui.syncMessage = '';
    } catch (e) {
      ui.syncStatus = 'error';
      ui.syncMessage = e.message || String(e);
    }
    render();
  }

  // Hızlı manuel yenileme (tarayıcıdan, ücretsiz/limitsiz uçlar): sadece
  // kripto + döviz. ABD hisseleri/altın/BIST scripts/update_prices.py
  // tarafından (Alpha Vantage, zamanlanmış rutin) güncellenir. Bu veri
  // kalıcı değildir, sayfa yenilenince baseline'a döner.
  const liveOverride = {};
  async function fetchQuickPrices() {
    try {
      const [cryptoRes, fxRes] = await Promise.all([
        fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd').then(r => r.json()).catch(() => null),
        fetch('https://open.er-api.com/v6/latest/USD').then(r => r.json()).catch(() => null)
      ]);
      const btc = cryptoRes && cryptoRes.bitcoin && cryptoRes.bitcoin.usd;
      const eth = cryptoRes && cryptoRes.ethereum && cryptoRes.ethereum.usd;
      const usdEur = fxRes && fxRes.rates && fxRes.rates.EUR;
      if (btc) liveOverride.BTC = btc;
      if (eth) liveOverride.ETH = eth;
      if (usdEur) liveOverride.EURUSD = 1 / usdEur;
    } catch (e) { /* sessizce yut, baseline fiyatları kullanılmaya devam eder */ }
    render();
  }

  // ---------- composition <-> baseline merge ----------
  function mergedHoldings() {
    return composition.holdings.map(c => {
      const b = baselinePriceBySymbol[c.symbol];
      const rawPrice = liveOverride[c.symbol] ?? (b ? b.price : 0) ?? 0;
      const hasLiveSource = !!(b && b.source === 'live') || !!liveOverride[c.symbol];
      // Gerçek fiyat yoksa (BIST/Fund/rutine dahil olmayan yeni semboller)
      // sembole göre sabit (seeded) bir demo fiyat üretilir — sayfa
      // yenilendiğinde aynı değer çıkar, rastgele zıplamaz.
      const price = rawPrice || (c.avgCost * (1 + (-0.12 + seededFactor(c.symbol) * 0.30)));
      const prevClose = (b && b.prevClose) || price;
      const priceHistory = (b && b.priceHistory) || [];
      return {
        ...c,
        price,
        prevClose,
        priceHistory,
        source: hasLiveSource ? 'live' : 'demo',
        coveredByRoutine: !!b
      };
    });
  }

  function nearestHistoryPrice(history, targetISO) {
    if (!history || !history.length) return null;
    // en yakın (aynı gün veya öncesi) kaydı bul; hiçbiri yoksa en eskisini kullan
    let best = null;
    for (const pt of history) {
      if (pt.date <= targetISO) { if (!best || pt.date > best.date) best = pt; }
    }
    if (!best) best = history.reduce((a, b) => (a.date < b.date ? a : b));
    return best;
  }

  function holdingMetrics(h) {
    const daily = h.prevClose ? ((h.price - h.prevClose) / h.prevClose) * 100 : null;
    const monthAgo = nearestHistoryPrice(h.priceHistory, daysAgoISO(30));
    const ytdStart = nearestHistoryPrice(h.priceHistory, yearStartISO());
    const yearAgo = nearestHistoryPrice(h.priceHistory, daysAgoISO(365));
    const oldestDate = h.priceHistory.length ? h.priceHistory.reduce((a, b) => (a.date < b.date ? a : b)).date : null;
    const enoughFor = (refDate) => oldestDate && oldestDate <= refDate;
    return {
      dailyPct: daily,
      monthlyPct: enoughFor(daysAgoISO(30)) && monthAgo ? ((h.price - monthAgo.price) / monthAgo.price) * 100 : null,
      ytdPct: enoughFor(yearStartISO()) && ytdStart ? ((h.price - ytdStart.price) / ytdStart.price) * 100 : null,
      yearlyPct: enoughFor(daysAgoISO(365)) && yearAgo ? ((h.price - yearAgo.price) / yearAgo.price) * 100 : null
    };
  }

  // Basitleştirme: geçmiş fiyat serisine GÜNCEL miktar uygulanarak "bugünkü
  // pozisyonla geçmişte ne olurdu" tipi bir değer serisi türetilir (gerçek
  // geçmiş işlem/miktar takibi yapılmıyor).
  function portfolioValueSeries() {
    const holdings = mergedHoldings();
    const dateSet = new Set();
    holdings.forEach(h => h.priceHistory.forEach(p => dateSet.add(p.date)));
    const dates = Array.from(dateSet).sort();
    if (!dates.length) return [];
    return dates.map(date => {
      let value = composition.cash || 0;
      holdings.forEach(h => {
        const rate = h.type === 'BIST' ? (baseline.usdTryRate || 34) : 1;
        const pt = nearestHistoryPrice(h.priceHistory, date);
        const price = pt ? pt.price : h.price;
        value += (h.quantity * price) / rate;
      });
      return { date, value };
    });
  }

  function currencyRate(cur) {
    if (cur === 'TRY') return baseline.usdTryRate || 34;
    if (cur === 'EUR') return baseline.eurUsdRate ? 1 / baseline.eurUsdRate : 0.9;
    return 1;
  }
  function fmtCur(usdAmount, cur) {
    cur = cur || composition.prefs.currency;
    const val = usdAmount * currencyRate(cur);
    return CURRENCIES[cur].symbol + fmt(val);
  }

  function computeAnalytics(processed, totalValue) {
    const series = portfolioValueSeries();
    const values = series.map(s => s.value);
    let volatility = null, maxDrawdown = null;
    if (values.length >= 3) {
      const returns = [];
      for (let i = 1; i < values.length; i++) returns.push((values[i] - values[i - 1]) / values[i - 1] * 100);
      volatility = stdev(returns);
    }
    if (values.length >= 2) {
      let peak = values[0], mdd = 0;
      values.forEach(v => { peak = Math.max(peak, v); mdd = Math.min(mdd, (v - peak) / peak * 100); });
      maxDrawdown = mdd;
    }
    const shares = processed.map(h => totalValue ? h.valueUSD / totalValue : 0);
    const cashShare = totalValue ? (composition.cash || 0) / totalValue : 0;
    const hhi = shares.reduce((a, s) => a + s * s, 0) + cashShare * cashShare;
    const diversification = (1 - hhi) * 100;
    const largestShare = Math.max(0, ...shares) * 100;
    const cryptoShare = processed.filter(h => h.type === 'Crypto').reduce((a, h) => a + h.valueUSD, 0) / (totalValue || 1) * 100;
    const bistShare = processed.filter(h => h.type === 'BIST').reduce((a, h) => a + h.valueUSD, 0) / (totalValue || 1) * 100;
    const cashSharePct = cashShare * 100;
    const riskScore = clamp(
      largestShare * 0.4 + cryptoShare * 0.35 + bistShare * 0.15 + Math.max(0, cashSharePct - 30) * 0.3,
      0, 100
    );
    return {
      volatility, maxDrawdown, diversification, riskScore,
      largestShare, cashSharePct, series,
      enoughForVol: values.length >= 3, enoughForDD: values.length >= 2
    };
  }

  // ---------- main view computation ----------
  function computeView() {
    const rawHoldings = mergedHoldings();
    const rate = baseline.usdTryRate || 34;
    const cur = composition.prefs.currency;

    const processed = rawHoldings.map(h => {
      const meta = TYPE_META[h.type] || TYPE_META.Other;
      const isBist = h.type === 'BIST';
      const div = isBist ? rate : 1;
      const valueUSD = (h.quantity * h.price) / div;
      const costUSD = (h.quantity * h.avgCost) / div;
      const pnlUSD = valueUSD - costUSD;
      const pnlPct = costUSD ? (pnlUSD / costUSD) * 100 : 0;
      const currencySym = isBist ? '₺' : '$';
      const m = holdingMetrics(h);
      return {
        ...h,
        typeLabel: meta.label, category: meta.category, typeColor: meta.color,
        valueUSD, costUSD, pnlUSD, pnlPct,
        priceDisplay: currencySym + h.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: h.type === 'Forex' ? 4 : 2 }),
        avgCostDisplay: currencySym + h.avgCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: h.type === 'Forex' ? 4 : 2 }),
        valueDisplay: fmtCur(valueUSD, cur),
        pnlDisplay: fmtCur(pnlUSD, cur),
        pnlPctDisplay: fmtPct(pnlPct),
        pnlColor: pnlUSD >= 0 ? '#34d399' : '#f87171',
        sourceLabel: h.source === 'live' ? 'Canlı' : 'Demo',
        sourceColor: h.source === 'live' ? '#34d399' : '#767c8a',
        dailyPct: m.dailyPct,
        dailyPctDisplay: fmtPct(m.dailyPct), monthlyPctDisplay: fmtPct(m.monthlyPct),
        ytdPctDisplay: fmtPct(m.ytdPct), yearlyPctDisplay: fmtPct(m.yearlyPct),
        dailyColor: m.dailyPct >= 0 ? '#34d399' : '#f87171',
        monthlyColor: (m.monthlyPct ?? 0) >= 0 ? '#34d399' : '#f87171',
        ytdColor: (m.ytdPct ?? 0) >= 0 ? '#34d399' : '#f87171',
        yearlyColor: (m.yearlyPct ?? 0) >= 0 ? '#34d399' : '#f87171'
      };
    });

    const cash = composition.cash || 0;
    const totalValue = processed.reduce((a, h) => a + h.valueUSD, 0) + cash;
    const totalCost = processed.reduce((a, h) => a + h.costUSD, 0);
    const totalPnL = processed.reduce((a, h) => a + h.pnlUSD, 0);
    const totalPnLPct = totalCost ? (totalPnL / totalCost) * 100 : 0;
    const dailyChangeUSD = processed.reduce((a, h) => {
      const div = h.type === 'BIST' ? rate : 1;
      return a + ((h.price - h.prevClose) * h.quantity) / div;
    }, 0);
    const prevTotal = totalValue - dailyChangeUSD;
    const dailyChangePct = prevTotal ? (dailyChangeUSD / prevTotal) * 100 : 0;

    const catTotals = {};
    processed.forEach(h => { catTotals[h.category] = (catTotals[h.category] || 0) + h.valueUSD; });
    catTotals['Nakit'] = cash;
    const catColors = { 'ABD Hisseleri': '#60a5fa', 'BIST Hisseleri': '#2dd4bf', 'Kripto': '#fbbf24', 'Döviz': '#a78bfa', 'Altın': '#eab308', 'Fon': '#f472b6', 'Diğer': '#9ca3af', 'Nakit': '#34d399' };
    const allocation = Object.keys(catTotals).map(label => {
      const value = catTotals[label];
      const pct = totalValue ? (value / totalValue) * 100 : 0;
      return { label, value, color: catColors[label] || '#9ca3af', valueDisplay: fmtCur(value, cur), pctDisplay: pct.toFixed(1) + '%', pct };
    }).filter(a => a.value > 0).sort((a, b) => b.value - a.value);

    const query = ui.searchQuery.toLowerCase();
    const filteredHoldings = processed
      .filter(h => ui.typeFilter === 'all' || h.type === ui.typeFilter)
      .filter(h => !query || h.symbol.toLowerCase().includes(query) || h.name.toLowerCase().includes(query));

    const analytics = computeAnalytics(processed, totalValue);

    return {
      processed, totalValue, totalCost, totalPnL, totalPnLPct,
      dailyChangeUSD, dailyChangePct,
      totalValueDisplay: fmtCur(totalValue, cur), totalCostDisplay: fmtCur(totalCost, cur),
      totalPnLDisplay: fmtCur(totalPnL, cur), totalPnLPctDisplay: fmtPct(totalPnLPct),
      dailyChangeDisplay: fmtCur(dailyChangeUSD, cur), dailyChangePctDisplay: fmtPct(dailyChangePct),
      cashDisplay: fmtCur(cash, cur),
      pnlColor: totalPnL >= 0 ? '#34d399' : '#f87171',
      dailyColor: dailyChangeUSD >= 0 ? '#34d399' : '#f87171',
      allocation, filteredHoldings,
      holdingsCountDisplay: filteredHoldings.length + ' varlık',
      analytics,
      lastUpdatedDisplay: baseline.lastUpdated ? ('Güncellendi: ' + new Date(baseline.lastUpdated).toLocaleString('tr-TR')) : 'Fiyatlar yükleniyor…',
      showDataBanner: true,
      aiNote: baseline.aiNote || '',
      advisorReport: baseline.advisorReport,
      opportunityReport: baseline.opportunityReport
    };
  }

  // ---------- small SVG helpers ----------
  function donutChart(allocation, size) {
    size = size || 160;
    const r = size / 2 - 10, cx = size / 2, cy = size / 2, circumference = 2 * Math.PI * r;
    let offset = 0;
    const segments = allocation.map(a => {
      const len = (a.pct / 100) * circumference;
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${a.color}" stroke-width="18"
        stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
      offset += len;
      return seg;
    }).join('');
    return `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px">${segments}</svg>`;
  }

  function lineChart(points300x100) {
    return `<svg viewBox="0 0 300 100" style="width:100%;height:160px;margin-top:12px" preserveAspectRatio="none">
      <polygon points="${points300x100.area}" fill="${points300x100.fill}"></polygon>
      <polyline points="${points300x100.line}" fill="none" stroke="${points300x100.color}" stroke-width="2"></polyline>
    </svg>`;
  }

  function seriesToPoints(series, valueKey) {
    if (!series.length) return null;
    const vals = series.map(s => s[valueKey]);
    const min = Math.min(...vals), max = Math.max(...vals), range = (max - min) || 1;
    const n = Math.max(series.length - 1, 1);
    const line = series.map((s, i) => (i / n) * 300 + ',' + (100 - ((s[valueKey] - min) / range) * 90 - 5)).join(' ');
    const up = vals[vals.length - 1] >= vals[0];
    return { line, area: '0,100 ' + line + ' 300,100', color: up ? '#34d399' : '#f87171', fill: up ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)' };
  }

  // ---------- render: shell pieces ----------
  function navStyle(active) {
    return active
      ? 'padding:10px 12px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;background:#1c2030;color:#fff;'
      : 'padding:10px 12px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;color:#8b90a0;';
  }

  function renderHoldingsRows(filteredHoldings) {
    return filteredHoldings.map(h => `
      <div style="display:grid;grid-template-columns:1.3fr 0.6fr 0.8fr 0.8fr 0.9fr 0.7fr 0.7fr 0.7fr 0.7fr 0.7fr 0.4fr;gap:8px;align-items:center;padding:12px 10px;border-radius:10px;font-size:13px;background:#0f1218;margin-bottom:6px">
        <div>
          <div style="font-weight:700">${esc(h.symbol)}</div>
          <div style="font-size:11px;color:#767c8a">${esc(h.name)}</div>
        </div>
        <div data-edit="quantity" data-id="${h.id}" style="color:#c7ccd6;cursor:text" title="Düzenlemek için tıklayın">${h.quantity}</div>
        <div data-edit="avgCost" data-id="${h.id}" style="color:#c7ccd6;cursor:text" title="Düzenlemek için tıklayın">${h.avgCostDisplay}</div>
        <div>
          <div style="color:#c7ccd6">${h.priceDisplay}</div>
          <div style="font-size:10px;color:${h.sourceColor}">${h.sourceLabel}${h.coveredByRoutine ? '' : ' · rutine dahil değil'}</div>
        </div>
        <div style="color:#eceef2;font-weight:600">${h.valueDisplay}</div>
        <div style="color:${h.pnlColor};font-weight:600;font-size:12px">${h.pnlPctDisplay}</div>
        <div style="color:${h.dailyColor};font-weight:600;font-size:12px">${h.dailyPctDisplay}</div>
        <div style="color:${h.monthlyColor};font-weight:600;font-size:12px">${h.monthlyPctDisplay}</div>
        <div style="color:${h.ytdColor};font-weight:600;font-size:12px">${h.ytdPctDisplay}</div>
        <div style="color:${h.yearlyColor};font-weight:600;font-size:12px">${h.yearlyPctDisplay}</div>
        <div data-action="remove" data-id="${h.id}" data-symbol="${esc(h.symbol)}" style="cursor:pointer;color:#767c8a;font-size:16px;text-align:center">×</div>
      </div>
    `).join('');
  }

  function renderPortfolioPage(v) {
    const pts = seriesToPoints(v.analytics.series, 'value');
    const typeOptions = ['all', 'US', 'BIST', 'Crypto', 'Forex', 'Gold', 'Fund', 'Other'].map(t => {
      const label = t === 'all' ? 'Tümü' : (TYPE_META[t] ? TYPE_META[t].label : t);
      return `<option value="${t}" ${ui.typeFilter === t ? 'selected' : ''}>${label}</option>`;
    }).join('');

    return `
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:20px">
        <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <div>
              <div style="font-size:14px;font-weight:600">Portföy Değeri</div>
              <div style="font-size:26px;font-weight:700;margin-top:6px">${v.totalValueDisplay}</div>
              <div style="font-size:12px;margin-top:2px;color:${v.dailyColor}">${v.dailyChangeDisplay} (${v.dailyChangePctDisplay}) bugün</div>
            </div>
          </div>
          ${pts ? lineChart(pts) : '<div style="height:160px;display:flex;align-items:center;justify-content:center;color:#4c5160;font-size:12px;margin-top:12px">Grafik için veri birikiyor (rutin çalıştıkça günlük kayıt eklenecek)</div>'}
          ${v.aiNote ? `<div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06)">
            <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:#7aa2f7">AI Portföy Yorumu</div>
            <div style="font-size:13px;color:#c7ccd6;line-height:1.5">${esc(v.aiNote)}</div>
          </div>` : ''}
        </div>
        <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:14px">Varlık Dağılımı</div>
          <div style="display:flex;align-items:center;gap:16px">
            ${donutChart(v.allocation, 130)}
            <div style="flex:1;min-width:0">
              ${v.allocation.map(a => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px">
                  <div style="display:flex;align-items:center;gap:6px;min-width:0">
                    <div style="width:8px;height:8px;border-radius:2px;background:${a.color};flex-shrink:0"></div>
                    <div style="color:#c7ccd6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.label)}</div>
                  </div>
                  <div style="flex-shrink:0;margin-left:8px;text-align:right"><div style="color:#c7ccd6;font-weight:600">${a.valueDisplay}</div><div style="color:#767c8a;font-size:10px">${a.pctDisplay}</div></div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div style="font-size:16px;font-weight:700">Varlıklarım</div>
        <div data-action="open-form" style="font-size:12px;font-weight:600;padding:9px 16px;border-radius:9px;background:#4d7cf0;cursor:pointer;color:#fff">+ Pozisyon Ekle</div>
      </div>
      <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <input id="search-input" placeholder="Varlık ara..." value="${esc(ui.searchQuery)}" style="background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:9px 12px;color:#eceef2;font-size:13px;width:220px;outline:none">
          <select id="type-filter-select" style="background:#171b24;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:9px 10px;color:#c7ccd6;font-size:12px">${typeOptions}</select>
          <div style="font-size:12px;color:#767c8a">${v.holdingsCountDisplay}</div>
        </div>
        <div style="display:grid;grid-template-columns:1.3fr 0.6fr 0.8fr 0.8fr 0.9fr 0.7fr 0.7fr 0.7fr 0.7fr 0.7fr 0.4fr;gap:8px;padding:0 10px 10px 10px;font-size:10px;color:#767c8a;text-transform:uppercase;letter-spacing:0.03em">
          <div>Varlık</div><div>Adet</div><div>Ort. Maliyet</div><div>Fiyat</div><div>Piyasa Değeri</div><div>Toplam</div><div>Günlük</div><div>Aylık</div><div>YTD</div><div>Yıllık</div><div></div>
        </div>
        <div id="holdings-rows">${renderHoldingsRows(v.filteredHoldings)}</div>
      </div>
    `;
  }

  function statTile(label, value, sub) {
    return `<div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:16px">
      <div style="font-size:11px;color:#767c8a">${label}</div>
      <div style="font-size:19px;font-weight:700;margin-top:6px">${value}</div>
      ${sub ? `<div style="font-size:10px;color:#767c8a;margin-top:2px">${sub}</div>` : ''}
    </div>`;
  }

  function renderAnalyticsPage(v) {
    const a = v.analytics;
    const cur = composition.prefs.currency;
    const topAssets = [...v.processed].sort((x, y) => y.pnlPct - x.pnlPct).slice(0, 5);
    const maxAbsPnl = Math.max(1, ...topAssets.map(h => Math.abs(h.pnlPct)));
    const gainLossPts = seriesToPoints(a.series, 'value');

    return `
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
        <select id="analytics-type-filter" style="background:#12151d;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:8px 10px;color:#eceef2;font-size:12px">
          <option value="all" ${ui.typeFilter === 'all' ? 'selected' : ''}>Tüm Varlık Sınıfları</option>
          ${Object.keys(TYPE_META).map(t => `<option value="${t}" ${ui.typeFilter === t ? 'selected' : ''}>${TYPE_META[t].label}</option>`).join('')}
        </select>
        <div style="padding:8px 12px;border-radius:9px;background:#12151d;border:1px solid rgba(255,255,255,0.08);font-size:12px;color:#767c8a">Bölge: Tümü (US/BIST)</div>
        <div style="padding:8px 12px;border-radius:9px;background:#12151d;border:1px solid rgba(255,255,255,0.08);font-size:12px;color:#767c8a">Portföy Türü: Kişisel</div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px">
        ${statTile('Toplam Değer', v.totalValueDisplay)}
        ${statTile('Getiri', v.totalPnLPctDisplay)}
        ${statTile('Volatilite (günlük)', a.enoughForVol ? a.volatility.toFixed(2) + '%' : '—', a.enoughForVol ? '' : 'veri birikiyor')}
        ${statTile('Maks. Düşüş', a.enoughForDD ? a.maxDrawdown.toFixed(2) + '%' : '—', a.enoughForDD ? '' : 'veri birikiyor')}
        ${statTile('Çeşitlendirme Oranı', a.diversification.toFixed(0) + '/100')}
        ${statTile('Risk Skoru', a.riskScore.toFixed(0) + '/100', 'kural tabanlı basit tahmin')}
        ${statTile('En Büyük Pozisyon', a.largestShare.toFixed(1) + '%')}
        ${statTile('Nakit Oranı', a.cashSharePct.toFixed(1) + '%')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:14px">Varlık Dağılımı</div>
          <div style="display:flex;align-items:center;gap:16px">
            ${donutChart(v.allocation, 120)}
            <div style="flex:1">${v.allocation.map(a2 => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0"><div style="color:#c7ccd6">${esc(a2.label)}</div><div style="text-align:right"><span style="color:#c7ccd6;font-weight:600">${a2.valueDisplay}</span> <span style="color:#767c8a">(${a2.pctDisplay})</span></div></div>`).join('')}</div>
          </div>
        </div>
        <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:14px">En İyi 5 Varlık (Getiri %)</div>
          <div style="display:flex;align-items:flex-end;gap:10px;height:120px">
            ${topAssets.map(h => `
              <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
                <div style="font-size:10px;color:${h.pnlColor};margin-bottom:4px">${h.pnlPctDisplay}</div>
                <div style="width:100%;background:${h.pnlColor};border-radius:4px 4px 0 0;height:${Math.max(4, Math.abs(h.pnlPct) / maxAbsPnl * 90)}px"></div>
                <div style="font-size:10px;color:#767c8a;margin-top:6px">${esc(h.symbol)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:14px">Varlık Türüne Göre Katkı</div>
          ${v.allocation.map(a2 => `
            <div style="margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><div style="color:#c7ccd6">${esc(a2.label)}</div><div style="text-align:right"><span style="color:#c7ccd6;font-weight:600">${a2.valueDisplay}</span> <span style="color:#767c8a">(${a2.pctDisplay})</span></div></div>
              <div style="height:8px;border-radius:4px;background:#0f1218;overflow:hidden"><div style="height:100%;border-radius:4px;background:${a2.color};width:${a2.pct.toFixed(1)}%"></div></div>
            </div>
          `).join('')}
        </div>
        <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:14px">Portföy Değer Değişimi</div>
          ${gainLossPts ? lineChart(gainLossPts) : '<div style="height:160px;display:flex;align-items:center;justify-content:center;color:#4c5160;font-size:12px">Grafik için veri birikiyor</div>'}
        </div>
      </div>
    `;
  }

  function renderReportBadge(risk) {
    const colors = { 'Düşük': '#34d399', 'Orta': '#fbbf24', 'Yüksek': '#f87171' };
    const c = colors[risk] || '#9ca3af';
    return `<div style="font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;background:${c}22;color:${c};display:inline-block">${esc(risk || '—')}</div>`;
  }

  function renderAdvicePage(v) {
    const r = v.advisorReport;
    if (!r) {
      return `<div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:24px;text-align:center;color:#767c8a;font-size:13px">
        Henüz bir AI portföy analizi üretilmedi. Zamanlanmış rutin ilk çalıştığında (her 8 saatte bir) burada
        Portföy Sağlık Skoru ve öneriler görünecek.
      </div>`;
    }
    return `
      <div style="display:flex;flex-direction:column;gap:16px">
        <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:14px;font-weight:600">Portföy Sağlık Skoru</div>
            <div style="font-size:24px;font-weight:700">${r.healthScore ?? '—'}/100</div>
          </div>
          <div style="font-size:13px;color:#c7ccd6;margin-top:10px;line-height:1.5">${esc(r.summary || '')}</div>
          <div style="font-size:11px;color:#767c8a;margin-top:10px;border-top:1px solid rgba(255,255,255,0.05);padding-top:10px">Veri kapsamı: ${esc(r.dataCoverageNote || '—')}</div>
          <div style="font-size:10px;color:#4c5160;margin-top:8px">Son üretim: ${r.generatedAt ? new Date(r.generatedAt).toLocaleString('tr-TR') : '—'} · Bu bir yatırım tavsiyesi değildir.</div>
        </div>
        ${(r.recommendations || []).map(rec => `
          <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:18px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="font-size:14px;font-weight:700">${esc(rec.symbol)} · ${esc(rec.action)}</div>
              <div style="display:flex;gap:8px;align-items:center">
                <div style="font-size:11px;color:#767c8a">Güven: %${rec.confidence ?? '—'}</div>
                ${renderReportBadge(rec.risk)}
              </div>
            </div>
            <div style="font-size:13px;color:#c7ccd6;margin-top:8px;line-height:1.5">${esc(rec.rationale || '')}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderOpportunitiesPage(v) {
    const r = v.opportunityReport;
    if (!r) {
      return `<div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:24px;text-align:center;color:#767c8a;font-size:13px">
        Henüz bir fırsat taraması üretilmedi. Zamanlanmış rutin ilk çalıştığında (her 8 saatte bir) burada
        BIST ve ABD piyasası fırsatları görünecek.
      </div>`;
    }
    const col = (title, items) => `
      <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
        <div style="font-size:14px;font-weight:600;margin-bottom:14px">${title}</div>
        ${items.length ? items.map(o => `
          <div style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="font-weight:700;font-size:13px">${esc(o.symbol)} <span style="color:#767c8a;font-weight:400">${esc(o.name || '')}</span></div>
              <div style="font-size:12px;font-weight:700;color:#7aa2f7">${o.opportunityScore ?? '—'}/100</div>
            </div>
            <div style="display:flex;gap:8px;margin-top:6px;align-items:center">
              <div style="font-size:11px;color:#767c8a">Güven: %${o.confidence ?? '—'}</div>
              ${renderReportBadge(o.risk)}
              <div style="font-size:11px;color:#767c8a">${esc(o.action || '')}</div>
            </div>
            <div style="font-size:12px;color:#c7ccd6;margin-top:8px">${esc(o.reason || '')}</div>
          </div>
        `).join('') : '<div style="font-size:12px;color:#767c8a">Bu dönemde öne çıkan fırsat bulunamadı.</div>'}
      </div>
    `;
    return `
      <div style="display:flex;flex-direction:column;gap:16px">
        <div style="font-size:11px;color:#767c8a">Veri kapsamı: ${esc(r.dataCoverageNote || '—')} · Son üretim: ${r.generatedAt ? new Date(r.generatedAt).toLocaleString('tr-TR') : '—'} · Yatırım tavsiyesi değildir.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          ${col('BIST Fırsatları', (r.items || []).filter(i => i.market === 'BIST'))}
          ${col('Amerikan Piyasası Fırsatları', (r.items || []).filter(i => i.market === 'US'))}
        </div>
      </div>
    `;
  }

  function renderAddModal() {
    if (!ui.showAddForm) return '';
    const sel = ui.addSelected;
    return `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:50">
        <div style="background:#151822;border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:26px;width:420px">
          <div style="font-size:16px;font-weight:700;margin-bottom:16px">Pozisyon Ekle</div>
          <div style="position:relative;margin-bottom:12px">
            <input id="pos-symbol" autocomplete="off" placeholder="Sembol ara (örn. AAPL, BTC, THYAO)" value="${sel ? esc(sel.symbol) : ''}" style="width:100%;background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:10px 12px;color:#eceef2;font-size:13px;outline:none">
            <div id="pos-suggestions" style="position:absolute;top:100%;left:0;right:0;background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;margin-top:4px;max-height:180px;overflow-y:auto;z-index:5;display:none"></div>
          </div>
          ${sel ? `<div style="font-size:11px;color:#767c8a;margin:-6px 0 12px 2px">${esc(sel.name)} · ${TYPE_META[sel.type].label}</div>` : `<div style="font-size:11px;color:#767c8a;margin:-6px 0 12px 2px">Listede yoksa aşağıdan tür seçip elle ekleyebilirsiniz</div>`}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            <div>
              <label style="font-size:11px;color:#767c8a">Çeşidi</label>
              <select id="pos-side" style="width:100%;margin-top:4px;background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:9px 10px;color:#eceef2;font-size:13px;outline:none">
                <option value="Al">Al</option>
                <option value="Sat">Sat</option>
              </select>
            </div>
            <div>
              <label style="font-size:11px;color:#767c8a">Tür (liste dışı ise)</label>
              <select id="pos-type" style="width:100%;margin-top:4px;background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:9px 10px;color:#eceef2;font-size:13px;outline:none">
                ${Object.keys(TYPE_META).map(t => `<option value="${t}" ${sel && sel.type === t ? 'selected' : ''}>${TYPE_META[t].label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            <div>
              <label style="font-size:11px;color:#767c8a">Tarih</label>
              <input id="pos-date" type="date" value="${todayISO()}" style="width:100%;margin-top:4px;background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:9px 10px;color:#eceef2;font-size:13px;outline:none">
            </div>
            <div>
              <label style="font-size:11px;color:#767c8a">Miktar</label>
              <input id="pos-qty" type="number" step="any" style="width:100%;margin-top:4px;background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:9px 10px;color:#eceef2;font-size:13px;outline:none">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
            <div>
              <label style="font-size:11px;color:#767c8a">Fiyat</label>
              <input id="pos-price" type="number" step="any" style="width:100%;margin-top:4px;background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:9px 10px;color:#eceef2;font-size:13px;outline:none">
            </div>
            <div>
              <label style="font-size:11px;color:#767c8a">Komisyon</label>
              <input id="pos-commission" type="number" step="any" value="0" style="width:100%;margin-top:4px;background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:9px 10px;color:#eceef2;font-size:13px;outline:none">
            </div>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <div data-action="cancel-form" style="flex:1;text-align:center;padding:10px;border-radius:9px;background:#1c2030;cursor:pointer;font-size:13px;font-weight:600;color:#c7ccd6">Vazgeç</div>
            <div data-action="submit-form" style="flex:1;text-align:center;padding:10px;border-radius:9px;background:#4d7cf0;cursor:pointer;font-size:13px;font-weight:600">Pozisyon Ekle</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderSuggestions(query) {
    const box = document.getElementById('pos-suggestions');
    if (!box) return;
    const q = query.trim().toLowerCase();
    if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const matches = SYMBOL_CATALOG.filter(s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'block';
    box.innerHTML = matches.map(m => `
      <div data-action="pick-symbol" data-symbol="${m.symbol}" data-name="${esc(m.name)}" data-type="${m.type}" style="padding:9px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.05)">
        <span style="font-weight:700">${esc(m.symbol)}</span> <span style="color:#767c8a">${esc(m.name)} · ${TYPE_META[m.type].label}</span>
      </div>
    `).join('');
  }

  // ---------- main render ----------
  function render() {
    const prevScroll = document.getElementById('main-scroll');
    const scrollTop = prevScroll ? prevScroll.scrollTop : 0;
    const v = computeView();
    const views = ['portfolio', 'analytics', 'news', 'advice', 'opportunities'];
    const navLabels = { portfolio: 'Portföy', analytics: 'Analiz', news: 'Haberler', advice: 'Tavsiyeler', opportunities: 'Fırsatlar' };
    const viewRenderers = { portfolio: renderPortfolioPage, analytics: renderAnalyticsPage, news: renderNews, advice: renderAdvicePage, opportunities: renderOpportunitiesPage };
    const titles = {
      portfolio: ['Portföy', 'Varlıklarınıza, performansınıza ve dağılımınıza genel bakış'],
      analytics: ['Analiz', 'Dağılım, performans ve risk kırılımı'],
      news: ['Haberler', 'Güncel başlıklar ve portföy etkisi'],
      advice: ['Tavsiyeler', 'AI destekli portföy değerlendirmesi'],
      opportunities: ['Fırsatlar', 'AI destekli BIST ve Amerikan piyasası tarama']
    };
    const [vt, vs] = titles[ui.view];
    const cur = composition.prefs.currency;

    const html = `
      <div style="height:100vh;width:100%;display:flex;background:#0a0c11;color:#eceef2;overflow:hidden">
        <div style="width:224px;flex-shrink:0;background:#101319;border-right:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;padding:20px 14px">
          <div style="height:28px;padding:6px 10px 22px 10px"></div>
          <div style="display:flex;flex-direction:column;gap:4px;flex:1">
            ${views.map(vw => `<div data-action="nav" data-view="${vw}" style="${navStyle(ui.view === vw)}">${navLabels[vw]}</div>`).join('')}
          </div>
          <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;display:flex;align-items:center;gap:10px">
            <div style="width:32px;height:32px;border-radius:50%;background:#2a3040;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#c7ccd6;flex-shrink:0">${esc((composition.profile.name || '?').slice(0, 2).toUpperCase())}</div>
            ${ui.editingProfile ? `
              <div style="display:flex;flex-direction:column;gap:4px;flex:1">
                <input id="profile-name" value="${esc(composition.profile.name)}" style="background:#0f1218;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 6px;color:#eceef2;font-size:12px;outline:none">
                <input id="profile-subtitle" value="${esc(composition.profile.subtitle)}" style="background:#0f1218;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:4px 6px;color:#eceef2;font-size:11px;outline:none">
              </div>
            ` : `
              <div data-action="edit-profile" style="cursor:pointer">
                <div style="font-size:13px;font-weight:600">${esc(composition.profile.name)}</div>
                <div style="font-size:11px;color:#767c8a">${esc(composition.profile.subtitle)}</div>
              </div>
            `}
          </div>
        </div>

        <div id="main-scroll" style="flex:1;display:flex;flex-direction:column;overflow-y:auto">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 32px 0 32px;flex-wrap:wrap;gap:12px">
            <div>
              <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em">${vt}</div>
              <div style="font-size:13px;color:#767c8a;margin-top:2px">${vs}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              ${ui.editingCash ? `
                <input id="cash-input" type="number" step="any" value="${composition.cash}" style="width:110px;background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:8px 10px;color:#eceef2;font-size:12px;outline:none">
                <div data-action="save-cash" style="font-size:12px;font-weight:600;padding:8px 12px;border-radius:9px;background:#4d7cf0;cursor:pointer;color:#fff">Kaydet</div>
              ` : `
                <div data-action="edit-cash" style="font-size:12px;color:#767c8a;cursor:pointer;padding:8px 10px" title="Nakit tutarını düzenle">Nakit: ${v.cashDisplay} ✎</div>
              `}
              <select id="currency-select" style="background:#171b24;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:8px 10px;color:#c7ccd6;font-size:12px">
                ${Object.keys(CURRENCIES).map(c => `<option value="${c}" ${cur === c ? 'selected' : ''}>${CURRENCIES[c].label}</option>`).join('')}
              </select>
              <div style="font-size:11px;color:#767c8a">${v.lastUpdatedDisplay}</div>
            </div>
          </div>

          <div style="display:flex;justify-content:flex-end;padding:8px 32px 0 32px">
            ${renderSyncControl()}
          </div>

          <div style="margin:16px 32px 0 32px;padding:10px 14px;border-radius:10px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);font-size:12px;color:#d9b26a">
            ABD hisseleri, BTC/ETH, USD/TRY ve USD/EUR için Alpha Vantage üzerinden canlı fiyatlar (8 saatte bir rutin) güncellenir. BIST hisseleri ve fonlar Alpha Vantage kapsamı dışında olduğu için demo değerlerdir. AI rutini analizini "Varlıklarım" listenizden yapar: GitHub senkronizasyonu açıksa (aşağıdaki durum göstergesi) her ekleme/çıkarma otomatik olarak repoya işlenir; kapalıysa rutin hâlâ index.html'deki son push edilmiş listeyi kullanır.
          </div>

          <div style="flex:1;padding:20px 32px 40px 32px">
            ${viewRenderers[ui.view](v)}
          </div>

          <div style="text-align:center;font-size:11px;color:#4c5160;padding-bottom:18px">Bu panel sadece bilgilendirme amaçlıdır ve yatırım tavsiyesi niteliği taşımaz.</div>
        </div>
      </div>
      ${renderAddModal()}
    `;

    document.getElementById('app').innerHTML = html;

    const newScroll = document.getElementById('main-scroll');
    if (newScroll) newScroll.scrollTop = scrollTop;

    if (ui.showAddForm) {
      const f = document.getElementById('pos-symbol');
      if (f) f.focus();
    }
    if (ui.editingProfile) {
      const f = document.getElementById('profile-name');
      if (f) f.focus();
    }
    if (ui.editingCash) {
      const f = document.getElementById('cash-input');
      if (f) { f.focus(); f.select(); }
    }
    if (ui.editingSync) {
      const f = document.getElementById('github-token-input');
      if (f) f.focus();
    }
  }

  function renderSyncControl() {
    if (ui.editingSync) {
      return `
        <div style="display:flex;align-items:center;gap:8px;font-size:12px">
          <input id="github-token-input" type="password" placeholder="GitHub Personal Access Token (repo yazma izinli)" value="${esc(getGithubToken())}" style="width:280px;background:#0f1218;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:7px 10px;color:#eceef2;font-size:12px;outline:none">
          <div data-action="save-github-token" style="font-weight:600;padding:7px 12px;border-radius:8px;background:#4d7cf0;cursor:pointer;color:#fff">Kaydet</div>
          ${getGithubToken() ? `<div data-action="clear-github-token" style="color:#f87171;cursor:pointer;padding:7px 10px">Bağlantıyı Kaldır</div>` : ''}
          <div data-action="cancel-sync-edit" style="color:#767c8a;cursor:pointer;padding:7px 10px">İptal</div>
        </div>
      `;
    }
    const statusMeta = {
      off: { color: '#767c8a', label: 'GitHub Senkronizasyonu: Kapalı ⚙' },
      ready: { color: '#767c8a', label: 'GitHub Senkronizasyonu: Hazır' },
      syncing: { color: '#fbbf24', label: 'GitHub\'a senkronize ediliyor…' },
      ok: { color: '#34d399', label: 'GitHub\'a senkronize edildi ✓' },
      error: { color: '#f87171', label: 'Senkronizasyon hatası ⚠' }
    };
    const s = statusMeta[ui.syncStatus] || statusMeta.off;
    return `<div data-action="edit-sync" title="${esc(ui.syncMessage || 'GitHub token ayarlamak için tıklayın')}" style="font-size:11px;color:${s.color};cursor:pointer">${s.label}</div>`;
  }

  function renderNews() {
    return `<div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:24px;text-align:center;color:#767c8a;font-size:13px">
      Haberler sayfası ayrı bir kapsam değişikliği kapsamında ele alınmadı; mevcut haliyle bırakıldı.
    </div>`;
  }

  // ---------- transactions ----------
  function applyTransaction({ symbol, name, type, side, quantity, price, commission }) {
    if (!symbol || !quantity || !price) return false;
    quantity = Math.abs(parseFloat(quantity));
    price = parseFloat(price);
    commission = parseFloat(commission) || 0;
    if (!quantity || Number.isNaN(price)) return false;

    const existing = composition.holdings.find(h => h.symbol === symbol);
    if (side === 'Sat') {
      if (!existing) return false;
      existing.quantity = Math.max(0, existing.quantity - quantity);
      if (existing.quantity === 0) {
        composition.holdings = composition.holdings.filter(h => h !== existing);
      }
    } else {
      if (existing) {
        const oldTotalCost = existing.quantity * existing.avgCost;
        const newTotalCost = quantity * price + commission;
        const newQty = existing.quantity + quantity;
        existing.avgCost = (oldTotalCost + newTotalCost) / newQty;
        existing.quantity = newQty;
      } else {
        composition.holdings.push({
          id: Date.now(), symbol, name: name || symbol, type: type || 'Other',
          quantity, avgCost: (quantity * price + commission) / quantity
        });
      }
    }
    saveComposition();
    scheduleSync();
    return true;
  }

  function submitAddForm() {
    const symbol = (document.getElementById('pos-symbol').value || '').toUpperCase().trim();
    const side = document.getElementById('pos-side').value;
    const type = document.getElementById('pos-type').value;
    const qty = document.getElementById('pos-qty').value;
    const price = document.getElementById('pos-price').value;
    const commission = document.getElementById('pos-commission').value;
    const name = ui.addSelected && ui.addSelected.symbol === symbol ? ui.addSelected.name : symbol;
    const ok = applyTransaction({ symbol, name, type, side, quantity: qty, price, commission });
    if (!ok) return;
    ui.showAddForm = false;
    ui.addSelected = null;
    render();
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'nav') { ui.view = el.dataset.view; render(); }
    else if (action === 'open-form') { ui.showAddForm = true; ui.addSelected = null; render(); }
    else if (action === 'cancel-form') { ui.showAddForm = false; ui.addSelected = null; render(); }
    else if (action === 'submit-form') submitAddForm();
    else if (action === 'pick-symbol') {
      ui.addSelected = { symbol: el.dataset.symbol, name: el.dataset.name, type: el.dataset.type };
      render();
    }
    else if (action === 'remove') {
      composition.holdings = composition.holdings.filter(h => h.id !== Number(el.dataset.id));
      saveComposition();
      scheduleSync();
      render();
    }
    else if (action === 'edit-profile') { ui.editingProfile = true; render(); }
    else if (action === 'edit-cash') { ui.editingCash = true; render(); }
    else if (action === 'save-cash') {
      const val = parseFloat(document.getElementById('cash-input').value);
      composition.cash = Number.isNaN(val) ? composition.cash : val;
      ui.editingCash = false;
      saveComposition();
      scheduleSync();
      render();
    }
    else if (action === 'edit-sync') { ui.editingSync = true; render(); }
    else if (action === 'cancel-sync-edit') { ui.editingSync = false; render(); }
    else if (action === 'save-github-token') {
      const val = (document.getElementById('github-token-input').value || '').trim();
      setGithubToken(val);
      ui.editingSync = false;
      ui.syncStatus = val ? 'ready' : 'off';
      render();
      if (val) syncHoldingsToGitHub();
    }
    else if (action === 'clear-github-token') {
      setGithubToken('');
      ui.editingSync = false;
      ui.syncStatus = 'off';
      render();
    }
    else if (el.dataset.edit) {
      const field = el.dataset.edit;
      const id = Number(el.dataset.id);
      const holding = composition.holdings.find(h => h.id === id);
      if (!holding) return;
      const current = holding[field];
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = current;
      input.style.cssText = 'width:100%;background:#0f1218;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:4px 6px;color:#eceef2;font-size:13px;outline:none';
      el.innerHTML = '';
      el.appendChild(input);
      input.focus();
      input.select();
      const commit = () => {
        const val = parseFloat(input.value);
        if (!Number.isNaN(val) && val >= 0) { holding[field] = val; saveComposition(); scheduleSync(); }
        render();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); });
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'search-input') {
      ui.searchQuery = e.target.value;
      const v = computeView();
      document.getElementById('holdings-rows').innerHTML = renderHoldingsRows(v.filteredHoldings);
    } else if (e.target.id === 'pos-symbol') {
      ui.addSelected = null;
      renderSuggestions(e.target.value);
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'currency-select') {
      composition.prefs.currency = e.target.value;
      saveComposition();
      render();
    } else if (e.target.id === 'analytics-type-filter' || e.target.id === 'type-filter-select') {
      ui.typeFilter = e.target.value;
      render();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.target.id === 'profile-name' || e.target.id === 'profile-subtitle') && e.key === 'Enter') {
      composition.profile.name = document.getElementById('profile-name').value.trim() || composition.profile.name;
      composition.profile.subtitle = document.getElementById('profile-subtitle').value.trim() || composition.profile.subtitle;
      ui.editingProfile = false;
      saveComposition();
      render();
    }
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.id === 'profile-name' || e.target.id === 'profile-subtitle') {
      const nameEl = document.getElementById('profile-name');
      const subEl = document.getElementById('profile-subtitle');
      if (!nameEl || !subEl) return;
      // İki input arasında geçişte kapanmasın diye kısa gecikme
      setTimeout(() => {
        if (document.activeElement === nameEl || document.activeElement === subEl) return;
        composition.profile.name = nameEl.value.trim() || composition.profile.name;
        composition.profile.subtitle = subEl.value.trim() || composition.profile.subtitle;
        ui.editingProfile = false;
        saveComposition();
        render();
      }, 120);
    }
  });

  render();
  fetchQuickPrices();
})();
