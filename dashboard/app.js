"use strict";

const DATA_BASE = "./data/";

const state = {
  latest: null,
  history: [],
  selectedReport: null,

  candleChart: null,
  rsiChart: null,
  volumeChart: null,
  historyChart: null,

  candleSeries: null,
  sma20Series: null,
  sma50Series: null,
  sma100Series: null,
  rsiSeries: null,
  volumeSeries: null,
  historySeries: null,
};

const TIMEFRAME_NAMES = {
  "15m": "15 minutes",
  "30m": "30 minutes",
  "1h": "1 hour",
  "Daily": "Daily",
};

const INDEX_IDS = {
  "Nifty 50": {
    price: "nifty-price",
    change: "nifty-change",
    rsi: "nifty-rsi",
    trend: "nifty-trend",
  },

  "Bank Nifty": {
    price: "bank-price",
    change: "bank-change",
    rsi: "bank-rsi",
    trend: "bank-trend",
  },

  "Nifty Midcap": {
    price: "midcap-price",
    change: "midcap-change",
    rsi: "midcap-rsi",
    trend: "midcap-trend",
  },
};


// ============================================================
// GENERAL HELPERS
// ============================================================

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = byId(id);

  if (element) {
    element.textContent = value;
  }
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function formatNumber(value, decimals = 2) {
  if (!numberValue(value)) {
    return "—";
  }

  return value.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPrice(value) {
  return formatNumber(value, 2);
}

function formatPercent(value) {
  if (!numberValue(value)) {
    return "—";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatScore(value) {
  if (!numberValue(value)) {
    return "—";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatLakh(value) {
  if (!numberValue(value)) {
    return "—";
  }

  return `${value < 0 ? "-" : ""}${(Math.abs(value) / 100000).toFixed(1)}L`;
}

function formatAge(hours) {
  if (!numberValue(hours)) {
    return "";
  }

  if (hours < 1) {
    return `${Math.max(1, Math.round(hours * 60))} min ago`;
  }

  if (hours < 24) {
    return `${Math.round(hours)} hours ago`;
  }

  return `${Math.round(hours / 24)} days ago`;
}

function safeDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setTone(element, value) {
  if (!element) {
    return;
  }

  element.classList.remove(
    "positive",
    "negative",
    "neutral",
    "bullish",
    "bearish",
  );

  if (!numberValue(value) || value === 0) {
    element.classList.add("neutral");
  } else if (value > 0) {
    element.classList.add("positive");
  } else {
    element.classList.add("negative");
  }
}

function signalTone(score) {
  if (!numberValue(score)) {
    return "neutral";
  }

  if (score > 0.15) {
    return "bullish";
  }

  if (score < -0.15) {
    return "bearish";
  }

  return "neutral";
}

function signalText(score) {
  if (!numberValue(score)) {
    return "Unavailable";
  }

  if (score >= 0.6) {
    return "Bullish";
  }

  if (score <= -0.6) {
    return "Bearish";
  }

  return "Neutral";
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return map[character];
  });
}

async function fetchJSON(path) {
  const response = await fetch(path, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Could not load ${path}: HTTP ${response.status}`);
  }

  return response.json();
}


// ============================================================
// CHART INITIALIZATION
// ============================================================

function chartOptions(container) {
  return {
    width: container.clientWidth,
    height: container.clientHeight,

    layout: {
      background: {
        type: "solid",
        color: "#111b2b",
      },

      textColor: "#93a4bc",
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 11,
    },

    grid: {
      vertLines: {
        color: "rgba(54, 73, 101, 0.24)",
      },

      horzLines: {
        color: "rgba(54, 73, 101, 0.24)",
      },
    },

    rightPriceScale: {
      borderColor: "#24334a",
    },

    timeScale: {
      borderColor: "#24334a",
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 3,
    },

    crosshair: {
      vertLine: {
        color: "#647790",
        labelBackgroundColor: "#263650",
      },

      horzLine: {
        color: "#647790",
        labelBackgroundColor: "#263650",
      },
    },

    localization: {
      locale: "en-IN",
    },

    handleScroll: true,
    handleScale: true,
  };
}

function createCharts() {
  if (!window.LightweightCharts) {
    throw new Error("The chart library could not be loaded.");
  }

  const candleContainer = byId("candlestick-chart");
  const rsiContainer = byId("rsi-chart");
  const volumeContainer = byId("volume-chart");
  const historyContainer = byId("history-chart");

  state.candleChart = LightweightCharts.createChart(
    candleContainer,
    chartOptions(candleContainer),
  );

  state.candleSeries = state.candleChart.addCandlestickSeries({
    upColor: "#35d49a",
    downColor: "#ff6b7d",
    borderUpColor: "#35d49a",
    borderDownColor: "#ff6b7d",
    wickUpColor: "#35d49a",
    wickDownColor: "#ff6b7d",
  });

  state.sma20Series = state.candleChart.addLineSeries({
    color: "#71a7ff",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
  });

  state.sma50Series = state.candleChart.addLineSeries({
    color: "#b99aff",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
  });

  state.sma100Series = state.candleChart.addLineSeries({
    color: "#f5c76b",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
  });


  state.rsiChart = LightweightCharts.createChart(
    rsiContainer,
    chartOptions(rsiContainer),
  );

  state.rsiSeries = state.rsiChart.addLineSeries({
    color: "#71a7ff",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
  });


  state.volumeChart = LightweightCharts.createChart(
    volumeContainer,
    chartOptions(volumeContainer),
  );

  state.volumeSeries = state.volumeChart.addHistogramSeries({
    priceFormat: {
      type: "volume",
    },

    priceLineVisible: false,
    lastValueVisible: true,
  });


  state.historyChart = LightweightCharts.createChart(
    historyContainer,
    chartOptions(historyContainer),
  );

  state.historySeries = state.historyChart.addLineSeries({
    color: "#71a7ff",
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
  });


  const resizeCharts = () => {
    const pairs = [
      [state.candleChart, candleContainer],
      [state.rsiChart, rsiContainer],
      [state.volumeChart, volumeContainer],
      [state.historyChart, historyContainer],
    ];

    for (const [chart, container] of pairs) {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    }
  };

  window.addEventListener("resize", resizeCharts);
}


// ============================================================
// MARKET OVERVIEW
// ============================================================

function renderMarketStatus(report) {
  const status = report.market_status || "Unknown";

  setText("market-status", status);

  const dot = byId("status-dot");

  if (dot) {
    dot.classList.toggle(
      "open",
      status.toUpperCase().includes("OPEN"),
    );
  }

  setText("updated-at", safeDate(report.generated_at));
}

function renderOverall(report) {
  const overall = report.overall || {};

  const score = numberValue(overall.score) ? overall.score : 0;

  setText("overall-score", formatScore(score));
  setText("overall-label", overall.label || "Unavailable");

  setText(
    "coverage-badge",
    `Coverage ${Math.round(overall.coverage_pct || 0)}%`,
  );

  const label = byId("overall-label");
  const gauge = byId("score-gauge");

  const tone =
    score >= 15
      ? "bullish"
      : score <= -15
        ? "bearish"
        : "neutral";

  if (label) {
    label.className = `signal-label ${tone}`;
  }

  if (gauge) {
    const normalized = Math.max(-100, Math.min(100, score));
    const percentage = (normalized + 100) / 200;

    const angle = percentage * 360;

    let color = "#f5c76b";

    if (score >= 15) {
      color = "#35d49a";
    } else if (score <= -15) {
      color = "#ff6b7d";
    }

    gauge.style.background = `
      conic-gradient(
        ${color} ${angle}deg,
        #29364a ${angle}deg 360deg
      )
    `;
  }

  let description = "The model's overall signal is neutral.";

  if (score >= 40) {
    description =
      "Strong bullish alignment across the available rule-based signals.";
  } else if (score >= 15) {
    description =
      "Bullish bias, subject to the quality and coverage of the data.";
  } else if (score <= -40) {
    description =
      "Strong bearish alignment across the available rule-based signals.";
  } else if (score <= -15) {
    description =
      "Bearish bias, subject to the quality and coverage of the data.";
  }

  setText("score-description", description);
}

function renderIndexCards(report) {
  const indices = report.indices || {};

  for (const [name, ids] of Object.entries(INDEX_IDS)) {
    const index = indices[name] || {};
    const timeframes = index.timeframes || {};
    const shortTerm = timeframes["15m"];

    if (!shortTerm) {
      setText(ids.price, "—");
      setText(ids.change, "Data unavailable");
      setText(ids.rsi, "—");
      setText(ids.trend, "Unavailable");
      continue;
    }

    setText(ids.price, formatPrice(shortTerm.close));
    setText(ids.change, formatPercent(shortTerm.chg));

    const changeElement = byId(ids.change);
    setTone(changeElement, shortTerm.chg);

    setText(
      ids.rsi,
      numberValue(shortTerm.rsi)
        ? shortTerm.rsi.toFixed(1)
        : "—",
    );

    setText(ids.trend, shortTerm.label || "Unavailable");
  }
}


// ============================================================
// CANDLESTICK CHART
// ============================================================

function renderCandlestickChart(report) {
  const indexName = byId("index-selector").value;
  const timeframe = byId("timeframe-selector").value;

  const index = report.indices?.[indexName];
  const candles = index?.charts?.[timeframe] || [];

  setText(
    "chart-title",
    `${indexName} candlestick chart · ${TIMEFRAME_NAMES[timeframe]}`,
  );

  if (!candles.length) {
    state.candleSeries.setData([]);
    state.sma20Series.setData([]);
    state.sma50Series.setData([]);
    state.sma100Series.setData([]);

    state.rsiSeries.setData([]);
    state.volumeSeries.setData([]);

    setText("rsi-current", "No chart data available");
    return;
  }

  const candleData = [];
  const sma20 = [];
  const sma50 = [];
  const sma100 = [];
  const rsi = [];
  const volume = [];

  for (const candle of candles) {
    const time = candle.time;

    if (
      !numberValue(time)
      || !numberValue(candle.open)
      || !numberValue(candle.high)
      || !numberValue(candle.low)
      || !numberValue(candle.close)
    ) {
      continue;
    }

    candleData.push({
      time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });

    if (numberValue(candle.sma20)) {
      sma20.push({
        time,
        value: candle.sma20,
      });
    }

    if (numberValue(candle.sma50)) {
      sma50.push({
        time,
        value: candle.sma50,
      });
    }

    if (numberValue(candle.sma100)) {
      sma100.push({
        time,
        value: candle.sma100,
      });
    }

    if (numberValue(candle.rsi)) {
      rsi.push({
        time,
        value: candle.rsi,
      });
    }

    volume.push({
      time,
      value: numberValue(candle.volume) ? candle.volume : 0,

      color:
        candle.close >= candle.open
          ? "rgba(53, 212, 154, 0.55)"
          : "rgba(255, 107, 125, 0.55)",
    });
  }

  state.candleSeries.setData(candleData);

  state.sma20Series.setData(sma20);
  state.sma50Series.setData(sma50);
  state.sma100Series.setData(sma100);

  state.rsiSeries.setData(rsi);
  state.volumeSeries.setData(volume);

  if (candleData.length) {
    state.candleChart.timeScale().fitContent();
    state.rsiChart.timeScale().fitContent();
    state.volumeChart.timeScale().fitContent();
  }

  const latest = candles[candles.length - 1];

  setText(
    "rsi-current",
    numberValue(latest.rsi)
      ? latest.rsi.toFixed(1)
      : "—",
  );
}


// ============================================================
// TIMEFRAME TABLE
// ============================================================

function renderTimeframeTable(report) {
  const indexName = byId("index-selector").value;
  const index = report.indices?.[indexName];
  const timeframes = index?.timeframes || {};

  const tbody = byId("timeframe-table");

  const order = ["15m", "30m", "1h", "Daily"];

  tbody.replaceChildren();

  for (const timeframe of order) {
    const item = timeframes[timeframe];

    const row = document.createElement("tr");

    if (!item) {
      row.innerHTML = `
        <td>${escapeHTML(timeframe)}</td>
        <td colspan="4">Unavailable</td>
      `;

      tbody.appendChild(row);
      continue;
    }

    const tone = signalTone(item.score);

    row.innerHTML = `
      <td>${escapeHTML(timeframe)}</td>
      <td>${formatPrice(item.close)}</td>
      <td class="${item.chg >= 0 ? "positive" : "negative"}">
        ${formatPercent(item.chg)}
      </td>
      <td>${numberValue(item.rsi) ? item.rsi.toFixed(1) : "—"}</td>
      <td class="${tone}">
        ${escapeHTML(item.label || "Unavailable")}
      </td>
    `;

    tbody.appendChild(row);
  }
}


// ============================================================
// OPTIONS
// ============================================================

function renderOptions(report) {
  const options = report.options;

  if (!options) {
    setText("options-source", "Unavailable");

    for (const id of [
      "option-spot",
      "option-atm",
      "option-pcr",
      "option-zone-pcr",
      "ce-premium",
      "pe-premium",
      "ce-premium-change",
      "pe-premium-change",
      "ce-oi",
      "pe-oi",
      "ce-oi-change",
      "pe-oi-change",
      "ce-buildup",
      "pe-buildup",
      "option-resistance",
      "option-support",
    ]) {
      setText(id, "—");
    }

    return;
  }

  setText("options-source", options.source || "Unknown");
  setText("option-spot", formatPrice(options.spot));
  setText("option-atm", formatNumber(options.atm, 0));
  setText("option-pcr", formatNumber(options.pcr, 2));
  setText("option-zone-pcr", formatNumber(options.zone_pcr, 2));

  setText("option-resistance", formatNumber(options.resistance, 0));
  setText("option-support", formatNumber(options.support, 0));

  const ce = options.ce || {};
  const pe = options.pe || {};

  setText("ce-premium", formatPrice(ce.ltp));
  setText("pe-premium", formatPrice(pe.ltp));

  setText("ce-premium-change", formatPrice(ce.ltpch));
  setText("pe-premium-change", formatPrice(pe.ltpch));

  setText("ce-oi", formatLakh(ce.oi));
  setText("pe-oi", formatLakh(pe.oi));

  setText("ce-oi-change", formatLakh(ce.oich));
  setText("pe-oi-change", formatLakh(pe.oich));

  setText("ce-buildup", ce.buildup || "Unavailable");
  setText("pe-buildup", pe.buildup || "Unavailable");
}


// ============================================================
// DAILY PIVOTS
// ============================================================

function renderPivots(report) {
  const pivots = report.pivots || {};
  const grid = byId("pivot-grid");

  const levels = [
    ["R2", pivots.R2],
    ["R1", pivots.R1],
    ["Pivot", pivots.P],
    ["S1", pivots.S1],
    ["S2", pivots.S2],
  ];

  grid.replaceChildren();

  for (const [name, value] of levels) {
    const box = document.createElement("div");
    box.className = "level-box";

    const label = document.createElement("span");
    label.textContent = name;

    const strong = document.createElement("strong");
    strong.textContent = formatNumber(value, 0);

    box.append(label, strong);
    grid.appendChild(box);
  }
}


// ============================================================
// GLOBAL MARKETS
// ============================================================

function renderGlobalMarkets(report) {
  const container = byId("global-market-grid");
  container.replaceChildren();

  const markets = report.global_markets || [];

  if (!markets.length) {
    container.textContent = "Global market data unavailable.";
    return;
  }

  for (const market of markets) {
    const card = document.createElement("div");
    card.className = "global-card";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = market.name || "Unknown";

    const price = document.createElement("strong");
    price.className = "price";
    price.textContent = formatPrice(market.price);

    const change = document.createElement("span");
    change.className = "change";

    if (numberValue(market.change_pct)) {
      change.textContent = formatPercent(market.change_pct);

      change.classList.add(
        market.change_pct > 0
          ? "positive"
          : market.change_pct < 0
            ? "negative"
            : "neutral",
      );
    } else {
      change.textContent = "Unavailable";
    }

    const category = document.createElement("span");
    category.className = "category";
    category.textContent = market.category || "market";

    card.append(name, price, change, category);

    container.appendChild(card);
  }
}


// ============================================================
// LAST SEVEN SESSIONS
// ============================================================

function renderPerformance(report) {
  const container = byId("performance-grid");
  container.replaceChildren();

  const indices = report.indices || {};

  for (const name of ["Nifty 50", "Bank Nifty", "Nifty Midcap"]) {
    const summary = indices[name]?.seven_day;

    const card = document.createElement("div");
    card.className = "performance-card";

    const title = document.createElement("h3");
    title.textContent = name;

    const net = document.createElement("div");
    net.className = "net";

    if (summary && numberValue(summary.net)) {
      net.textContent = formatPercent(summary.net);

      net.classList.add(
        summary.net > 0
          ? "positive"
          : summary.net < 0
            ? "negative"
            : "neutral",
      );
    } else {
      net.textContent = "Unavailable";
    }

    const meta = document.createElement("div");
    meta.className = "meta";

    const upDays = document.createElement("span");
    upDays.textContent = summary
      ? `${summary.up}/7 up days`
      : "—";

    const position = document.createElement("span");
    position.textContent = summary
      ? `${formatNumber(summary.pos, 0)}% of range`
      : "—";

    meta.append(upDays, position);
    card.append(title, net, meta);

    container.appendChild(card);
  }
}


// ============================================================
// SCORE BREAKDOWN
// ============================================================

function renderScoreBreakdown(report) {
  const container = byId("score-breakdown");
  container.replaceChildren();

  const components = report.scores?.components || [];

  if (!components.length) {
    container.textContent = "Score components unavailable.";
    return;
  }

  for (const component of components) {
    const row = document.createElement("div");
    row.className = "score-row";

    const name = document.createElement("div");
    name.className = "score-row-name";
    name.textContent = component.name;

    const track = document.createElement("div");
    track.className = "score-bar-track";

    const bar = document.createElement("div");
    bar.className = "score-bar";

    if (!numberValue(component.score)) {
      bar.classList.add("zero");
      bar.style.width = "0%";
    } else {
      bar.style.width = `${Math.abs(component.score) * 100}%`;

      bar.classList.add(
        component.score > 0
          ? "positive"
          : component.score < 0
            ? "negative"
            : "zero",
      );
    }

    track.appendChild(bar);

    const value = document.createElement("div");
    value.className = "score-row-value";

    value.textContent = numberValue(component.score)
      ? `${formatScore(component.score)}`
      : "N/A";

    row.append(name, track, value);
    container.appendChild(row);
  }
}


// ============================================================
// NEWS
// ============================================================

function renderNews(report) {
  const container = byId("news-list");
  container.replaceChildren();

  const news = report.news || {};
  const items = news.items || [];

  const sentiment = news.score;

  const badge = byId("news-sentiment");

  if (badge) {
    badge.className = "badge";

    if (!numberValue(sentiment) || Math.abs(sentiment) < 0.15) {
      badge.classList.add("neutral");
      badge.textContent = "Sentiment neutral";
    } else if (sentiment > 0) {
      badge.classList.add("bullish");
      badge.textContent = "Sentiment positive";
    } else {
      badge.classList.add("bearish");
      badge.textContent = "Sentiment negative";
    }
  }

  if (!items.length) {
    container.textContent = "No recent headlines available.";
    return;
  }

  for (const item of items) {
    const row = document.createElement("article");
    row.className = "news-item";

    const icon = document.createElement("div");
    icon.className = "news-sentiment-icon";

    icon.textContent =
      item.score > 0
        ? "↑"
        : item.score < 0
          ? "↓"
          : "•";

    const content = document.createElement("div");

    const link = document.createElement("a");
    link.className = "news-title";
    link.textContent = item.title || "Untitled headline";

    const url = item.url || "";

    // Only accept HTTP/HTTPS news links.
    try {
      const parsed = new URL(url, window.location.href);

      if (
        parsed.protocol === "https:"
        || parsed.protocol === "http:"
      ) {
        link.href = parsed.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    } catch (_) {
      // Leave the headline as plain text if its URL is invalid.
    }

    const meta = document.createElement("div");
    meta.className = "news-meta";

    const source = document.createElement("span");
    source.textContent = item.source || "News source";

    const age = document.createElement("span");
    age.textContent = formatAge(item.age);

    meta.append(source, age);

    for (const tagText of item.tags || []) {
      const tag = document.createElement("span");
      tag.className = "news-tag";
      tag.textContent = tagText;

      meta.appendChild(tag);
    }

    content.append(link, meta);
    row.append(icon, content);

    container.appendChild(row);
  }
}


// ============================================================
// HISTORICAL SNAPSHOTS
// ============================================================

async function loadHistoryIndex() {
  try {
    const history = await fetchJSON(
      `${DATA_BASE}history/index.json`,
    );

    state.history = Array.isArray(history) ? history : [];

  } catch (error) {
    console.warn("Historical index unavailable:", error);
    state.history = [];
  }

  const selector = byId("history-selector");
  selector.replaceChildren();

  const latestOption = document.createElement("option");
  latestOption.value = "latest";
  latestOption.textContent = "Latest report";

  selector.appendChild(latestOption);

  for (const item of state.history) {
    if (!item.file) {
      continue;
    }

    const option = document.createElement("option");

    option.value = item.file;
    option.textContent = safeDate(item.generated_at);

    selector.appendChild(option);
  }

  renderHistoryChart();
}

async function loadSelectedHistory() {
  const selected = byId("history-selector").value;

  if (selected === "latest") {
    state.selectedReport = state.latest;

    renderHistorySelection(state.latest);
    return;
  }

  try {
    const report = await fetchJSON(
      `${DATA_BASE}snapshots/${encodeURIComponent(selected)}`,
    );

    state.selectedReport = report;

    renderHistorySelection(report);

  } catch (error) {
    console.error("Could not load selected snapshot:", error);

    setText("history-selected-date", "Could not load snapshot");
    setText("history-selected-score", "—");
    setText("history-selected-label", "—");
  }
}

function renderHistorySelection(report) {
  if (!report) {
    return;
  }

  setText(
    "history-selected-date",
    safeDate(report.generated_at),
  );

  setText(
    "history-selected-score",
    formatScore(report.overall?.score),
  );

  setText(
    "history-selected-label",
    report.overall?.label || "—",
  );
}

function renderHistoryChart() {
  if (!state.historySeries) {
    return;
  }

  const chartData = [];

  // The history index is newest-first; reverse it for plotting.
  const ordered = [...state.history].reverse();

  for (const item of ordered) {
    if (!item.generated_at || !numberValue(item.score)) {
      continue;
    }

    const timestamp = Math.floor(
      new Date(item.generated_at).getTime() / 1000,
    );

    if (!Number.isFinite(timestamp)) {
      continue;
    }

    chartData.push({
      time: timestamp,
      value: item.score,
    });
  }

  state.historySeries.setData(chartData);

  if (chartData.length) {
    state.historyChart.timeScale().fitContent();
  }
}


// ============================================================
// MAIN RENDER
// ============================================================

function renderReport(report) {
  if (!report || !report.indices) {
    throw new Error("The market report has an unexpected format.");
  }

  state.latest = report;

  renderMarketStatus(report);
  renderOverall(report);
  renderIndexCards(report);

  renderCandlestickChart(report);
  renderTimeframeTable(report);

  renderOptions(report);
  renderPivots(report);

  renderGlobalMarkets(report);
  renderPerformance(report);
  renderScoreBreakdown(report);
  renderNews(report);

  renderHistorySelection(report);
}

async function loadLatestReport() {
  const refreshButton = byId("refresh-button");

  refreshButton.disabled = true;
  refreshButton.textContent = "Loading…";

  try {
    const report = await fetchJSON(
      `${DATA_BASE}latest.json?t=${Date.now()}`,
    );

    renderReport(report);

  } catch (error) {
    console.error(error);

    setText(
      "score-description",
      "Unable to load market data. Run the GitHub Actions workflow and try again.",
    );

  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh";
  }
}


// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEvents() {
  byId("refresh-button").addEventListener(
    "click",
    async () => {
      await loadLatestReport();
      await loadHistoryIndex();
    },
  );

  byId("index-selector").addEventListener("change", () => {
    if (state.latest) {
      renderCandlestickChart(state.latest);
      renderTimeframeTable(state.latest);
    }
  });

  byId("timeframe-selector").addEventListener("change", () => {
    if (state.latest) {
      renderCandlestickChart(state.latest);
    }
  });

  byId("history-selector").addEventListener(
    "change",
    loadSelectedHistory,
  );
}


// ============================================================
// STARTUP
// ============================================================

async function init() {
  try {
    createCharts();
    setupEvents();

    await loadLatestReport();
    await loadHistoryIndex();

  } catch (error) {
    console.error("Dashboard initialization failed:", error);

    setText(
      "score-description",
      "Dashboard initialization failed. Check the browser console and confirm the chart library is available.",
    );
  }
}

document.addEventListener("DOMContentLoaded", init);