// Vault — Portföy Takip Paneli
// Veri kaynağı: index.html içindeki #portfolio-data script bloğu.
// Fiyatlar scripts/update_prices.py tarafından (Alpha Vantage üzerinden,
// zamanlanmış rutinle) periyodik olarak güncellenir; bu dosya sadece render eder.

(function () {
  const TYPE_META = {
    US: { label: 'ABD Hissesi', category: 'ABD Hisseleri', color: '#60a5fa' },
    BIST: { label: 'BIST Hissesi', category: 'BIST Hisseleri', color: '#2dd4bf' },
    Crypto: { label: 'Kripto', category: 'Kripto', color: '#fbbf24' },
    Forex: { label: 'Döviz', category: 'Döviz', color: '#a78bfa' },
    Gold: { label: 'Altın', category: 'Altın', color: '#eab308' },
    Fund: { label: 'Fon', category: 'Fon', color: '#f472b6' },
    Other: { label: 'Diğer', category: 'Diğer', color: '#9ca3af' }
  };

  function seededFactor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return (h % 1000) / 1000;
  }
  function fmtUSD(n) {
    const sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(n) {
    const sign = n >= 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const initial = JSON.parse(document.getElementById('portfolio-data').textContent);

  const state = {
    view: 'dashboard',
    searchQuery: '',
    showAddForm: false,
    ...initial
  };

  function applyDemoPrices() {
    state.holdings = state.holdings.map(h => {
      if (h.price) return h;
      const jitter = -0.12 + seededFactor(h.symbol) * 0.30;
      return { ...h, price: h.cost * (1 + jitter) };
    });
  }

  // Tarayıcıdan hızlı manuel yenileme: sadece kripto + döviz (ücretsiz,
  // limitsiz uçlar). ABD hisseleri / altın / BIST scripts/update_prices.py
  // tarafından (Alpha Vantage, zamanlanmış rutin) güncellenir.
  async function fetchQuickPrices() {
    try {
      const [cryptoRes, fxRes] = await Promise.all([
        fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd').then(r => r.json()).catch(() => null),
        fetch('https://open.er-api.com/v6/latest/USD').then(r => r.json()).catch(() => null)
      ]);
      const btc = cryptoRes && cryptoRes.bitcoin && cryptoRes.bitcoin.usd;
      const eth = cryptoRes && cryptoRes.ethereum && cryptoRes.ethereum.usd;
      const usdTry = fxRes && fxRes.rates && fxRes.rates.TRY;
      const usdEur = fxRes && fxRes.rates && fxRes.rates.EUR;
      state.holdings = state.holdings.map(h => {
        if (h.symbol === 'BTC' && btc) return { ...h, price: btc, source: 'live' };
        if (h.symbol === 'ETH' && eth) return { ...h, price: eth, source: 'live' };
        if (h.symbol === 'EURUSD' && usdEur) return { ...h, price: 1 / usdEur, source: 'live' };
        return h;
      });
      state.usdTryRate = usdTry || state.usdTryRate;
      state.pricesLoaded = true;
    } catch (e) {
      state.loadError = true;
    }
    render();
  }

  function setView(v) { state.view = v; render(); }

  function removeHolding(id, symbol) {
    state.holdings = state.holdings.filter(h => h.id !== id);
    state.activityLog = [{ text: symbol + ' kaldırıldı', time: 'Az önce' }, ...state.activityLog].slice(0, 8);
    render();
  }

  function computeView() {
    const s = state;
    const rate = s.usdTryRate || 34;
    const processed = s.holdings.map(h => {
      const meta = TYPE_META[h.type] || TYPE_META.Other;
      const isBist = h.type === 'BIST';
      const div = isBist ? rate : 1;
      const valueUSD = (h.quantity * h.price) / div;
      const costUSD = (h.quantity * h.cost) / div;
      const pnlUSD = valueUSD - costUSD;
      const pnlPct = costUSD ? (pnlUSD / costUSD) * 100 : 0;
      const currencySym = isBist ? '₺' : '$';
      return {
        ...h,
        typeLabel: meta.label,
        category: meta.category,
        valueUSD, costUSD, pnlUSD, pnlPct,
        priceDisplay: currencySym + h.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: h.type === 'Forex' ? 4 : 2 }),
        costDisplay: currencySym + h.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: h.type === 'Forex' ? 4 : 2 }),
        valueDisplay: fmtUSD(valueUSD),
        pnlDisplay: fmtUSD(pnlUSD),
        pnlPctDisplay: fmtPct(pnlPct),
        pnlColor: pnlUSD >= 0 ? '#34d399' : '#f87171',
        sourceLabel: h.source === 'live' ? 'Canlı' : 'Demo',
        sourceColor: h.source === 'live' ? '#34d399' : '#767c8a'
      };
    });

    const cash = s.cash || 0;
    const totalValue = processed.reduce((a, h) => a + h.valueUSD, 0) + cash;
    const totalCost = processed.reduce((a, h) => a + h.costUSD, 0);
    const totalPnL = processed.reduce((a, h) => a + h.pnlUSD, 0);
    const totalPnLPct = totalCost ? (totalPnL / totalCost) * 100 : 0;

    const catTotals = {};
    processed.forEach(h => { catTotals[h.category] = (catTotals[h.category] || 0) + h.valueUSD; });
    catTotals['Nakit'] = cash;
    const catColors = { 'ABD Hisseleri': '#60a5fa', 'BIST Hisseleri': '#2dd4bf', 'Kripto': '#fbbf24', 'Döviz': '#a78bfa', 'Altın': '#eab308', 'Fon': '#f472b6', 'Diğer': '#9ca3af', 'Nakit': '#34d399' };
    const allocation = Object.keys(catTotals).map(label => {
      const value = catTotals[label];
      const pct = totalValue ? (value / totalValue) * 100 : 0;
      const color = catColors[label] || '#9ca3af';
      return {
        label, value, color,
        valueDisplay: fmtUSD(value),
        pctDisplay: pct.toFixed(1) + '%',
        barStyle: 'flex:' + Math.max(pct, 0.3) + ';background:' + color,
        dotStyle: 'width:8px;height:8px;border-radius:2px;background:' + color,
        fillStyle: 'height:100%;border-radius:4px;background:' + color + ';width:' + pct.toFixed(1) + '%'
      };
    }).filter(a => a.value > 0).sort((a, b) => b.value - a.value);

    const bySymbolPnl = [...processed].sort((a, b) => b.pnlPct - a.pnlPct);
    const topMovers = bySymbolPnl.length ? [
      { ...bySymbolPnl[0], color: bySymbolPnl[0].pnlUSD >= 0 ? '#34d399' : '#f87171' },
      { ...bySymbolPnl[bySymbolPnl.length - 1], color: bySymbolPnl[bySymbolPnl.length - 1].pnlUSD >= 0 ? '#34d399' : '#f87171' }
    ] : [];

    const hist = s.history && s.history.length ? s.history : [totalValue];
    const min = Math.min(...hist), max = Math.max(...hist), range = (max - min) || 1;
    const pts = hist.map((v, i) => (i / (Math.max(hist.length - 1, 1))) * 300 + ',' + (100 - ((v - min) / range) * 90 - 5)).join(' ');
    const chartUp = hist[hist.length - 1] >= hist[0];

    const query = s.searchQuery.toLowerCase();
    const filteredHoldings = processed.filter(h => !query || h.symbol.toLowerCase().includes(query) || h.name.toLowerCase().includes(query));

    const largest = processed.length ? processed.reduce((a, b) => a.valueUSD > b.valueUSD ? a : b) : null;
    const riskNotes = [];
    if (largest && totalValue) {
      const share = largest.valueUSD / totalValue * 100;
      if (share > 25) riskNotes.push({ text: largest.symbol + ' portföyünüzün %' + share.toFixed(1) + '’ini oluşturuyor — konsantrasyon riski.', dotStyle: 'width:6px;height:6px;border-radius:50%;background:#fbbf24;margin-top:6px;flex-shrink:0' });
    }
    const cashShare = totalValue ? cash / totalValue * 100 : 0;
    if (cashShare > 15) riskNotes.push({ text: 'Nakit, portföyünüzün %' + cashShare.toFixed(1) + '’i — getiri sağlamayan boşta duran sermaye.', dotStyle: 'width:6px;height:6px;border-radius:50%;background:#7aa2f7;margin-top:6px;flex-shrink:0' });
    const cryptoAlloc = allocation.find(a => a.label === 'Kripto');
    if (cryptoAlloc && totalValue && (cryptoAlloc.value / totalValue * 100) > 20) riskNotes.push({ text: 'Kripto ağırlığı %' + (cryptoAlloc.value / totalValue * 100).toFixed(1) + ' — yüksek volatiliteli bir varlık sınıfı.', dotStyle: 'width:6px;height:6px;border-radius:50%;background:#fbbf24;margin-top:6px;flex-shrink:0' });
    if (processed.some(h => h.type === 'BIST')) riskNotes.push({ text: 'BIST hisseleri bulundurmak getirilerinize USD/TRY kur riski ekler.', dotStyle: 'width:6px;height:6px;border-radius:50%;background:#a78bfa;margin-top:6px;flex-shrink:0' });
    if (!riskNotes.length) riskNotes.push({ text: 'Mevcut varlıklarda önemli bir konsantrasyon veya kur riski tespit edilmedi.', dotStyle: 'width:6px;height:6px;border-radius:50%;background:#34d399;margin-top:6px;flex-shrink:0' });

    const adviceList = riskNotes.map((r, i) => ({ title: 'Portföy Notu ' + (i + 1), text: r.text, dotStyle: 'width:10px;height:10px;border-radius:50%;background:' + (r.dotStyle.includes('34d399') ? '#34d399' : r.dotStyle.includes('fbbf24') ? '#fbbf24' : r.dotStyle.includes('7aa2f7') ? '#7aa2f7' : '#a78bfa') + ';margin-top:4px;flex-shrink:0' }));
    if (topMovers.length === 2) {
      adviceList.push({ title: 'En İyi Performans: ' + topMovers[0].symbol, text: topMovers[0].pnlPctDisplay + ' artışta. Tezinize göre kâr realizasyonu ya da pozisyonu koruma seçeneklerini değerlendirin.', dotStyle: 'width:10px;height:10px;border-radius:50%;background:#34d399;margin-top:4px;flex-shrink:0' });
      adviceList.push({ title: 'Düşük Performans: ' + topMovers[1].symbol, text: 'Maliyet bazına göre ' + topMovers[1].pnlPctDisplay + '. Orijinal yatırım tezinizin geçerliliğini gözden geçirin.', dotStyle: 'width:10px;height:10px;border-radius:50%;background:#f87171;margin-top:4px;flex-shrink:0' });
    }

    const newsPool = [
      { sym: 'AAPL', headline: 'AAPL: Analistler bilanço öncesi hedef fiyatları yükseltti', sentiment: 'positive', source: 'Market Wire', time: '2 sa önce' },
      { sym: 'NVDA', headline: 'NVDA: Yapay zeka çipi talebi büyümenin ana itici gücü', sentiment: 'positive', source: 'Tech Daily', time: '4 sa önce' },
      { sym: 'THYAO', headline: 'TCMB politika güncellemesi BIST’te işlem gören ihracatçılarda oynaklık yarattı', sentiment: 'neutral', source: 'BIST Bülteni', time: '5 sa önce' },
      { sym: 'BTC', headline: 'Kurumsal girişler hızlanırken Bitcoin yükseliyor', sentiment: 'positive', source: 'Crypto Ledger', time: '1 sa önce' },
      { sym: 'MSFT', headline: 'MSFT bulut segmenti büyümesi hafif yavaşladı, tahminleri geçti', sentiment: 'neutral', source: 'Market Wire', time: '8 sa önce' },
      { sym: 'EURUSD', headline: 'Faiz beklentilerindeki ayrışmayla euro dolar karşısında zayıfladı', sentiment: 'negative', source: 'FX Desk', time: '3 sa önce' }
    ];
    const heldSymbols = new Set(processed.map(h => h.symbol));
    const sentimentMeta = {
      positive: { label: 'Pozitif', badgeStyle: 'font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;background:rgba(52,211,153,0.12);color:#34d399' },
      negative: { label: 'Negatif', badgeStyle: 'font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;background:rgba(248,113,113,0.12);color:#f87171' },
      neutral: { label: 'Nötr', badgeStyle: 'font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;background:rgba(167,139,250,0.12);color:#a78bfa' }
    };
    const newsItems = newsPool.map(n => {
      const meta = sentimentMeta[n.sentiment];
      const held = heldSymbols.has(n.sym);
      return {
        ...n,
        sentimentLabel: meta.label,
        badgeStyle: meta.badgeStyle,
        impact: held
          ? (n.sym + ' pozisyonunuz var — bu durum ' + (n.sentiment === 'positive' ? 'pozisyonunuzu destekliyor' : n.sentiment === 'negative' ? 'pozisyonunuz üzerinde baskı yaratabilir' : 'pozisyonunuzu sınırlı etkiliyor') + '.')
          : ('Doğrudan etkilenen bir varlığınız yok.')
      };
    });

    const bistOpportunities = [
      { symbol: 'SASA', name: 'Sasa Polyester', theme: 'İhracat marjı toparlanması', note: 'Kimya ihracatçısı, marj trendi ve döviz kuruna bağlı gelir karması açısından iyi görünüyor.' },
      { symbol: 'KCHOL', name: 'Koç Holding', theme: 'Çeşitlendirilmiş holding', note: 'Geniş sektör dağılımı nedeniyle genellikle daha düşük volatiliteli bir BIST çekirdek pozisyonu olarak kullanılır.' },
      { symbol: 'EREGL', name: 'Erdemir', theme: 'Emtia döngüsü', note: 'Küresel emtia fiyat trendlerine hassas bir çelik üreticisi.' },
      { symbol: 'TUPRS', name: 'Tüpraş', theme: 'Rafineri marjları', note: 'Rafineri marjları bu hisse için önemli bir takip metriği olmuştur.' }
    ];
    const usOpportunities = [
      { symbol: 'AVGO', name: 'Broadcom Inc.', theme: 'Yapay zeka altyapısı', note: 'Veri merkezi ağ çözümleri ve özel çip talebi açısından iyi görünüyor.' },
      { symbol: 'LLY', name: 'Eli Lilly', theme: 'Sağlık sektörü büyümesi', note: 'Metabolik sağlık alanındaki geniş ilaç geliştirme portföyü analistlerin dikkatini çekiyor.' },
      { symbol: 'CRM', name: 'Salesforce', theme: 'Kurumsal yazılım', note: 'Sürekli tekrarlayan gelir büyümesiyle birlikte marj genişlemesi hikayesi.' },
      { symbol: 'XOM', name: 'ExxonMobil', theme: 'Enerji geliri', note: 'Enerji fiyat dalgalanmalarında temettü kararlılığı için sıklıkla taranan bir hisse.' }
    ];

    const titles = {
      dashboard: ['Panel', 'Portföy performansınıza genel bakış'],
      portfolio: ['Portföy', 'Varlıklarınızı, maliyet bazınızı ve K/Z’nizi yönetin'],
      analytics: ['Analiz', 'Dağılım, performans ve risk kırılımı'],
      news: ['Haberler', 'Güncel başlıklar ve portföy etkisi'],
      advice: ['Tavsiyeler', 'Portföyünüz üzerine kural tabanlı gözlemler'],
      opportunities: ['Fırsatlar', 'BIST ve Amerikan piyasası tarama fikirleri']
    };
    const [vt, vs] = titles[s.view];

    return {
      viewTitle: vt, viewSubtitle: vs,
      totalValueDisplay: fmtUSD(totalValue), totalCostDisplay: fmtUSD(totalCost), totalPnLDisplay: fmtUSD(totalPnL),
      totalPnLPctDisplay: fmtPct(totalPnLPct), cashDisplay: fmtUSD(cash), pnlColor: totalPnL >= 0 ? '#34d399' : '#f87171',
      chartPoints: pts, chartAreaPoints: '0,100 ' + pts + ' 300,100',
      chartColor: chartUp ? '#34d399' : '#f87171', chartFillColor: chartUp ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
      allocation, topMovers, activityLog: s.activityLog,
      filteredHoldings, holdingsCountDisplay: filteredHoldings.length + ' varlık',
      riskNotes, adviceList, newsItems, bistOpportunities, usOpportunities,
      lastUpdatedDisplay: s.lastUpdated ? ('Güncellendi: ' + new Date(s.lastUpdated).toLocaleString('tr-TR')) : 'Fiyatlar yükleniyor…',
      showDemoBanner: !!s.pricesLoaded,
      aiNote: s.aiNote || ''
    };
  }

  function navStyle(active) {
    return active
      ? 'padding:10px 12px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;background:#1c2030;color:#fff;'
      : 'padding:10px 12px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;color:#8b90a0;';
  }

  function renderHoldingsRows(filteredHoldings) {
    return filteredHoldings.map(h => `
      <div style="display:grid;grid-template-columns:1.4fr 0.9fr 0.7fr 0.9fr 0.9fr 1fr 0.9fr 0.4fr;gap:8px;align-items:center;padding:12px 10px;border-radius:10px;font-size:13px;background:#0f1218;margin-bottom:6px">
        <div>
          <div style="font-weight:700">${esc(h.symbol)}</div>
          <div style="font-size:11px;color:#767c8a">${esc(h.name)}</div>
        </div>
        <div style="color:#c7ccd6;font-size:12px">${esc(h.typeLabel)}</div>
        <div style="color:#c7ccd6">${h.quantity}</div>
        <div style="color:#c7ccd6">${esc(h.costDisplay)}</div>
        <div>
          <div style="color:#c7ccd6">${esc(h.priceDisplay)}</div>
          <div style="font-size:10px;color:${h.sourceColor}">${h.sourceLabel}</div>
        </div>
        <div style="color:#eceef2;font-weight:600">${esc(h.valueDisplay)}</div>
        <div style="color:${h.pnlColor};font-weight:600">
          <div>${esc(h.pnlDisplay)}</div>
          <div style="font-size:11px">${esc(h.pnlPctDisplay)}</div>
        </div>
        <div data-action="remove" data-id="${h.id}" data-symbol="${esc(h.symbol)}" style="cursor:pointer;color:#767c8a;font-size:16px;text-align:center">×</div>
      </div>
    `).join('');
  }

  function renderDashboard(v) {
    return `
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px">
        <div style="display:flex;flex-direction:column;gap:20px">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
            <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:18px">
              <div style="font-size:12px;color:#767c8a">Toplam Değer</div>
              <div style="font-size:22px;font-weight:700;margin-top:6px">${v.totalValueDisplay}</div>
            </div>
            <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:18px">
              <div style="font-size:12px;color:#767c8a">Gerçekleşmemiş K/Z</div>
              <div style="font-size:22px;font-weight:700;margin-top:6px;color:${v.pnlColor}">${v.totalPnLDisplay}</div>
            </div>
            <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:18px">
              <div style="font-size:12px;color:#767c8a">Kullanılabilir Nakit</div>
              <div style="font-size:22px;font-weight:700;margin-top:6px">${v.cashDisplay}</div>
            </div>
            <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:18px">
              <div style="font-size:12px;color:#767c8a">Getiri</div>
              <div style="font-size:22px;font-weight:700;margin-top:6px;color:${v.pnlColor}">${v.totalPnLPctDisplay}</div>
            </div>
          </div>

          <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <div style="font-size:14px;font-weight:600">Portföy Değeri (20 gün)</div>
              <div style="font-size:20px;font-weight:700;color:${v.pnlColor}">${v.totalValueDisplay}</div>
            </div>
            <svg viewBox="0 0 300 100" style="width:100%;height:160px;margin-top:12px" preserveAspectRatio="none">
              <polygon points="${v.chartAreaPoints}" fill="${v.chartFillColor}"></polygon>
              <polyline points="${v.chartPoints}" fill="none" stroke="${v.chartColor}" stroke-width="2"></polyline>
            </svg>
          </div>

          ${v.aiNote ? `
          <div style="background:#12151d;border:1px solid rgba(122,162,247,0.25);border-radius:16px;padding:20px">
            <div style="font-size:14px;font-weight:600;margin-bottom:8px;color:#7aa2f7">AI Portföy Yorumu</div>
            <div style="font-size:13px;color:#c7ccd6;line-height:1.5">${esc(v.aiNote)}</div>
          </div>` : ''}

          <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
            <div style="font-size:14px;font-weight:600;margin-bottom:12px">Son İşlemler</div>
            ${v.activityLog.map(act => `
              <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:13px">
                <div style="color:#c7ccd6">${esc(act.text)}</div>
                <div style="color:#767c8a">${esc(act.time)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:20px">
          <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
            <div style="font-size:14px;font-weight:600;margin-bottom:14px">Varlık Dağılımı</div>
            <div style="display:flex;height:10px;border-radius:6px;overflow:hidden;margin-bottom:14px">
              ${v.allocation.map(a => `<div style="${a.barStyle}"></div>`).join('')}
            </div>
            ${v.allocation.map(a => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px">
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="${a.dotStyle}"></div>
                  <div style="color:#c7ccd6">${esc(a.label)}</div>
                </div>
                <div style="color:#767c8a">${a.valueDisplay} · ${a.pctDisplay}</div>
              </div>
            `).join('')}
          </div>

          <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
            <div style="font-size:14px;font-weight:600;margin-bottom:10px">En İyi / En Kötü Performans</div>
            ${v.topMovers.map(m => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
                <div>
                  <div style="font-size:13px;font-weight:600">${esc(m.symbol)}</div>
                  <div style="font-size:11px;color:#767c8a">${esc(m.name)}</div>
                </div>
                <div style="font-size:13px;font-weight:600;color:${m.color}">${m.pnlPctDisplay}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderPortfolio(v) {
    return `
      <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <input id="search-input" placeholder="Varlık ara..." value="${esc(state.searchQuery)}" style="background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:9px 12px;color:#eceef2;font-size:13px;width:240px;outline:none">
          <div style="font-size:12px;color:#767c8a">${v.holdingsCountDisplay}</div>
        </div>
        <div style="display:grid;grid-template-columns:1.4fr 0.9fr 0.7fr 0.9fr 0.9fr 1fr 0.9fr 0.4fr;gap:8px;padding:0 10px 10px 10px;font-size:11px;color:#767c8a;text-transform:uppercase;letter-spacing:0.04em">
          <div>Varlık</div><div>Tür</div><div>Adet</div><div>Ort. Maliyet</div><div>Fiyat</div><div>Piyasa Değeri</div><div>K/Z</div><div></div>
        </div>
        <div id="holdings-rows">${renderHoldingsRows(v.filteredHoldings)}</div>
      </div>
    `;
  }

  function renderAnalytics(v) {
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:16px">Varlık Sınıfına Göre Dağılım</div>
          ${v.allocation.map(a => `
            <div style="margin-bottom:12px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">
                <div style="color:#c7ccd6">${esc(a.label)}</div>
                <div style="color:#767c8a">${a.pctDisplay}</div>
              </div>
              <div style="height:8px;border-radius:4px;background:#0f1218;overflow:hidden">
                <div style="${a.fillStyle}"></div>
              </div>
            </div>
          `).join('')}
        </div>
        <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:16px">Performans Özeti</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><div style="font-size:11px;color:#767c8a">Toplam Maliyet</div><div style="font-size:18px;font-weight:700;margin-top:4px">${v.totalCostDisplay}</div></div>
            <div><div style="font-size:11px;color:#767c8a">Piyasa Değeri</div><div style="font-size:18px;font-weight:700;margin-top:4px">${v.totalValueDisplay}</div></div>
            <div><div style="font-size:11px;color:#767c8a">Gerçekleşmemiş K/Z</div><div style="font-size:18px;font-weight:700;margin-top:4px;color:${v.pnlColor}">${v.totalPnLDisplay}</div></div>
            <div><div style="font-size:11px;color:#767c8a">Getiri</div><div style="font-size:18px;font-weight:700;margin-top:4px;color:${v.pnlColor}">${v.totalPnLPctDisplay}</div></div>
          </div>
        </div>
        <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px;grid-column:1 / -1">
          <div style="font-size:14px;font-weight:600;margin-bottom:14px">Risk Notları</div>
          ${v.riskNotes.map(r => `
            <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:13px">
              <div style="${r.dotStyle}"></div>
              <div style="color:#c7ccd6">${esc(r.text)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderNews(v) {
    return `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="font-size:12px;color:#767c8a">Örnek haber akışı — başlıklar ve etki notları temsili amaçlıdır, canlı haber kaynağından gelmez.</div>
        ${v.newsItems.map(n => `
          <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:18px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div style="font-size:14px;font-weight:600;max-width:80%">${esc(n.headline)}</div>
              <div style="${n.badgeStyle}">${n.sentimentLabel}</div>
            </div>
            <div style="font-size:11px;color:#767c8a;margin-top:4px">${esc(n.source)} · ${esc(n.time)}</div>
            <div style="font-size:13px;color:#c7ccd6;margin-top:10px">${esc(n.impact)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderAdvice(v) {
    return `
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="font-size:12px;color:#767c8a">Mevcut varlıklarınıza dayalı kural tabanlı gözlemler — sadece bilgi amaçlıdır, yatırım tavsiyesi değildir.</div>
        ${v.adviceList.map(ad => `
          <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:18px;display:flex;gap:14px">
            <div style="${ad.dotStyle}"></div>
            <div>
              <div style="font-size:14px;font-weight:600">${esc(ad.title)}</div>
              <div style="font-size:13px;color:#c7ccd6;margin-top:6px">${esc(ad.text)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderOpportunities(v) {
    const col = (title, items, themeColor) => `
      <div style="background:#12151d;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px">
        <div style="font-size:14px;font-weight:600;margin-bottom:14px">${title}</div>
        ${items.map(o => `
          <div style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
            <div style="display:flex;justify-content:space-between">
              <div style="font-weight:700;font-size:13px">${esc(o.symbol)}</div>
              <div style="font-size:11px;color:${themeColor}">${esc(o.theme)}</div>
            </div>
            <div style="font-size:11px;color:#767c8a;margin-top:2px">${esc(o.name)}</div>
            <div style="font-size:12px;color:#c7ccd6;margin-top:6px">${esc(o.note)}</div>
          </div>
        `).join('')}
      </div>
    `;
    return `
      <div style="display:flex;flex-direction:column;gap:16px">
        <div style="font-size:12px;color:#767c8a">Temsili tarama fikirleridir; analist görüşü veya yatırım tavsiyesi değildir. Her zaman kendi araştırmanızı yapın.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          ${col('BIST Fırsatları', v.bistOpportunities, '#7ee0c0')}
          ${col('Amerikan Piyasası Fırsatları', v.usOpportunities, '#7aa2f7')}
        </div>
      </div>
    `;
  }

  function renderAddModal() {
    if (!state.showAddForm) return '';
    return `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:50">
        <div style="background:#151822;border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:26px;width:380px">
          <div style="font-size:16px;font-weight:700;margin-bottom:16px">Varlık Ekle</div>
          <div style="display:flex;flex-direction:column;gap:12px">
            <input id="f-symbol" placeholder="Sembol (örn. AAPL)" style="background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:10px 12px;color:#eceef2;font-size:13px;outline:none">
            <input id="f-name" placeholder="Ad" style="background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:10px 12px;color:#eceef2;font-size:13px;outline:none">
            <select id="f-type" style="background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:10px 12px;color:#eceef2;font-size:13px;outline:none">
              <option value="US">ABD Hissesi</option>
              <option value="BIST">BIST Hissesi</option>
              <option value="Crypto">Kripto</option>
              <option value="Forex">Döviz</option>
              <option value="Gold">Altın</option>
              <option value="Fund">Fon</option>
              <option value="Other">Diğer</option>
            </select>
            <div style="display:flex;gap:10px">
              <input id="f-qty" placeholder="Adet" style="flex:1;background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:10px 12px;color:#eceef2;font-size:13px;outline:none">
              <input id="f-cost" placeholder="Ort. Maliyet" style="flex:1;background:#0f1218;border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:10px 12px;color:#eceef2;font-size:13px;outline:none">
            </div>
          </div>
          <div style="display:flex;gap:10px;margin-top:20px">
            <div data-action="cancel-form" style="flex:1;text-align:center;padding:10px;border-radius:9px;background:#1c2030;cursor:pointer;font-size:13px;font-weight:600;color:#c7ccd6">Vazgeç</div>
            <div data-action="submit-form" style="flex:1;text-align:center;padding:10px;border-radius:9px;background:#4d7cf0;cursor:pointer;font-size:13px;font-weight:600">Ekle</div>
          </div>
        </div>
      </div>
    `;
  }

  function render() {
    applyDemoPrices();
    const v = computeView();
    const views = ['dashboard', 'portfolio', 'analytics', 'news', 'advice', 'opportunities'];
    const navLabels = { dashboard: 'Panel', portfolio: 'Portföy', analytics: 'Analiz', news: 'Haberler', advice: 'Tavsiyeler', opportunities: 'Fırsatlar' };
    const viewRenderers = { dashboard: renderDashboard, portfolio: renderPortfolio, analytics: renderAnalytics, news: renderNews, advice: renderAdvice, opportunities: renderOpportunities };

    const html = `
      <div style="height:100vh;width:100%;display:flex;background:#0a0c11;color:#eceef2;overflow:hidden">
        <div style="width:224px;flex-shrink:0;background:#101319;border-right:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;padding:20px 14px">
          <div style="display:flex;align-items:center;gap:10px;padding:6px 10px 22px 10px">
            <div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#5b8def,#7ee0c0)"></div>
            <div style="font-size:17px;font-weight:700;letter-spacing:-0.02em">Vault</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex:1">
            ${views.map(vw => `<div data-action="nav" data-view="${vw}" style="${navStyle(state.view === vw)}">${navLabels[vw]}</div>`).join('')}
          </div>
          <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;display:flex;align-items:center;gap:10px">
            <div style="width:32px;height:32px;border-radius:50%;background:#2a3040;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#c7ccd6">EC</div>
            <div>
              <div style="font-size:13px;font-weight:600">Ethan Cole</div>
              <div style="font-size:11px;color:#767c8a">Kişisel Portföy</div>
            </div>
          </div>
        </div>

        <div style="flex:1;display:flex;flex-direction:column;overflow-y:auto">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 32px 0 32px">
            <div>
              <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em">${v.viewTitle}</div>
              <div style="font-size:13px;color:#767c8a;margin-top:2px">${v.viewSubtitle}</div>
            </div>
            <div style="display:flex;align-items:center;gap:12px">
              <div style="font-size:11px;color:#767c8a">${v.lastUpdatedDisplay}</div>
              <div data-action="refresh" style="font-size:12px;font-weight:600;padding:9px 14px;border-radius:9px;background:#171b24;border:1px solid rgba(255,255,255,0.08);cursor:pointer;color:#c7ccd6">Fiyatları Güncelle</div>
              <div data-action="open-form" style="font-size:12px;font-weight:600;padding:9px 16px;border-radius:9px;background:#4d7cf0;cursor:pointer;color:#fff">+ Varlık Ekle</div>
            </div>
          </div>

          ${v.showDemoBanner ? `
          <div style="margin:16px 32px 0 32px;padding:10px 14px;border-radius:10px;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);font-size:12px;color:#d9b26a">
            ABD hisseleri, BTC/ETH, USD/TRY ve USD/EUR için Alpha Vantage üzerinden canlı fiyatlar (saatlik/periyodik rutin ile) güncellenir. BIST hisseleri ve fon Alpha Vantage kapsamı dışında olduğu için demo değerlerdir.
          </div>` : ''}

          <div style="flex:1;padding:20px 32px 40px 32px">
            ${viewRenderers[state.view](v)}
          </div>

          <div style="text-align:center;font-size:11px;color:#4c5160;padding-bottom:18px">Bu panel sadece bilgilendirme amaçlıdır ve yatırım tavsiyesi niteliği taşımaz.</div>
        </div>
      </div>
      ${renderAddModal()}
    `;

    document.getElementById('app').innerHTML = html;

    if (state.showAddForm) {
      const f = document.getElementById('f-symbol');
      if (f) f.focus();
    }
  }

  function submitForm() {
    const symbol = (document.getElementById('f-symbol').value || '').toUpperCase().trim();
    const name = document.getElementById('f-name').value.trim();
    const type = document.getElementById('f-type').value;
    const quantity = parseFloat(document.getElementById('f-qty').value);
    const cost = parseFloat(document.getElementById('f-cost').value);
    if (!symbol || !quantity || !cost) return;
    const jitter = -0.12 + seededFactor(symbol) * 0.30;
    state.holdings = [...state.holdings, { id: Date.now(), symbol, name: name || symbol, type, quantity, cost, price: cost * (1 + jitter), source: 'demo' }];
    state.activityLog = [{ text: symbol + ' eklendi', time: 'Az önce' }, ...state.activityLog].slice(0, 8);
    state.showAddForm = false;
    render();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'nav') setView(el.dataset.view);
    else if (action === 'refresh') fetchQuickPrices();
    else if (action === 'open-form') { state.showAddForm = true; render(); }
    else if (action === 'cancel-form') { state.showAddForm = false; render(); }
    else if (action === 'submit-form') submitForm();
    else if (action === 'remove') removeHolding(Number(el.dataset.id), el.dataset.symbol);
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'search-input') {
      state.searchQuery = e.target.value;
      const v = computeView();
      document.getElementById('holdings-rows').innerHTML = renderHoldingsRows(v.filteredHoldings);
    }
  });

  render();
  fetchQuickPrices();
})();
