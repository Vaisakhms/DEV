/* Market Pulse Dashboard — Complete JavaScript */
(() => {
“use strict”;

const DATA_URL = “./data/latest.json”;
const HISTORY_URL = “./data/history/index.json”;
const REFRESH_INTERVAL = 60000;

const $ = id => document.getElementById(id);

const state = {
data: null,
history: [],
selectedIndex: “Nifty 50”,
timeframe: “Daily”,
charts: {},
refreshing: false
};

const INDEX_NAMES = [
“Nifty 50”,
“Bank Nifty”,
“Nifty Midcap”
];

function number(value) {
if (value === null || value === undefined || value === “”) {
return null;
}

const n = Number(value);
return Number.isFinite(n) ? n : null;

}

function fmt(value, decimals = 2) {
const n = number(value);

if (n === null) return "—";
return n.toLocaleString("en-IN", {
  minimumFractionDigits: decimals,
  maximumFractionDigits: decimals
});

}

function compact(value) {
const n = number(value);

if (n === null) return "—";
return Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 2
}).format(n);

}

function pct(value) {
const n = number(value);

if (n === null) return "—";
return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;

}

function tone(value) {
const n = number(value);

if (n === null || n === 0) return "neutral";
return n > 0 ? "positive" : "negative";

}

function esc(value) {
return String(value ?? “”).replace(/[&<>”’]/g, char => ({
“&”: “&”,
“<”: “<”,
“>”: “>”,
‘”’: “"”,
“’”: “'”
})[char]);
}

function setText(id, value) {
const el = $(id);

if (el) {
  el.textContent = value ?? "—";
}

}

function setHTML(id, html) {
const el = $(id);

if (el) {
  el.innerHTML = html;
}

}

function array(value) {
if (Array.isArray(value)) return value;

if (value && typeof value === "object") {
  return Object.values(value);
}
return [];

}

function indexData(name, data = state.data) {
return data?.indices?.[name] || {};
}

function timeframeData(index, timeframe = state.timeframe) {
return index?.timeframes?.[timeframe]
|| index?.timeframes?.Daily
|| {};
}

function labelClass(label) {
const text = String(label || “”).toLowerCase();

if (text.includes("bull")) return "positive";
if (text.includes("bear")) return "negative";
return "neutral";

}

function dateLabel(value) {
if (!value) return “—”;

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
  hour12: true
}) + " IST";

}

async function fetchJSON(url) {
const separator = url.includes(”?”) ? “&” : “?”;

const response = await fetch(
  `${url}${separator}_=${Date.now()}`,
  { cache: "no-store" }
);
if (!response.ok) {
  throw new Error(
    `HTTP ${response.status}: ${url}`
  );
}
return response.json();

}

function notify(message) {
const toast = $(“toast”);

if (!toast) {
  console.log(message);
  return;
}
toast.textContent = message;
toast.classList.add("show");
setTimeout(() => {
  toast.classList.remove("show");
}, 3500);

}

function renderHeader(data) {
setText(
“marketStatus”,
data.market_status || “Market status unavailable”
);

setText(
  "lastUpdated",
  dateLabel(data.generated_at_ist || data.generated_at)
);
setText(
  "dataTimestamp",
  data.generated_at_ist || data.generated_at || "—"
);
setText("dataStatus", "Data loaded");

}

function renderOverall(data) {
const overall = data.overall || {};
const score = number(overall.score);

setText("overallScore", fmt(score, 1));
setText("overallLabel", overall.label || "Market Bias");
setText("scoreGaugeValue", fmt(score, 1));
setText(
  "scoreNote",
  score === null
    ? "Overall market score unavailable."
    : `Overall model score: ${fmt(score, 1)}`
);
const boundedScore = score === null
  ? 0
  : Math.max(0, Math.min(100, score));
if ($("scoreTrackFill")) {
  $("scoreTrackFill").style.width =
    `${boundedScore}%`;
}
if ($("scoreGauge")) {
  $("scoreGauge").style.setProperty(
    "--score",
    `${boundedScore * 3.6}deg`
  );
}
const coverage = number(overall.coverage_pct);
setText(
  "coverageValue",
  coverage === null ? "—" : `${fmt(coverage, 0)}%`
);
if ($("coverageFill")) {
  $("coverageFill").style.width =
    `${Math.max(0, Math.min(100, coverage || 0))}%`;
}

}

function renderSnapshot(data) {
const html = INDEX_NAMES.map(name => {
const index = indexData(name, data);

  const frame =
    index.timeframes?.Daily
    || Object.values(index.timeframes || {})[0]
    || {};
  const label =
    frame.label
    || (number(frame.score) > 0 ? "Bullish" : "Market");
  return `
    <article class="panel index-card">
      <div class="index-card-top">
        <span class="eyebrow">${esc(name)}</span>
        <span class="badge ${labelClass(label)}">
          ${esc(label)}
        </span>
      </div>
      <div class="index-price">
        ${fmt(frame.close)}
      </div>
      <div class="index-change ${tone(frame.chg)}">
        ${pct(frame.chg)}
      </div>
      <div class="index-card-metrics">
        <div>
          <small>RSI</small>
          <strong>${fmt(frame.rsi, 1)}</strong>
        </div>
        <div>
          <small>SMA 20</small>
          <strong>${fmt(frame.sma?.["20"])}</strong>
        </div>
        <div>
          <small>SMA 50</small>
          <strong>${fmt(frame.sma?.["50"])}</strong>
        </div>
      </div>
    </article>
  `;
}).join("");
setHTML("indexCards", html);

}

/* PART 2 STARTS BELOW */
function renderTechnical(data) {
const cards = [];

INDEX_NAMES.forEach(name => {
  const index = indexData(name, data);
  ["15m", "30m", "1h", "Daily"].forEach(tf => {
    const frame = index.timeframes?.[tf];
    if (!frame) return;
    const label = frame.label || "Trend";
    cards.push(`
      <article class="panel technical-card">
        <div class="technical-card-head">
          <strong>${esc(name)}</strong>
          <span class="badge ${labelClass(label)}">
            ${esc(tf)} · ${esc(label)}
          </span>
        </div>
        <div class="technical-metrics">
          <div>
            <small>Close</small>
            <strong>${fmt(frame.close)}</strong>
          </div>
          <div>
            <small>Change</small>
            <strong class="${tone(frame.chg)}">
              ${pct(frame.chg)}
            </strong>
          </div>
          <div>
            <small>RSI 14</small>
            <strong>${fmt(frame.rsi, 1)}</strong>
          </div>
          <div>
            <small>SMA 20</small>
            <strong>${fmt(frame.sma?.["20"])}</strong>
          </div>
          <div>
            <small>SMA 50</small>
            <strong>${fmt(frame.sma?.["50"])}</strong>
          </div>
          <div>
            <small>SMA 100</small>
            <strong>${fmt(frame.sma?.["100"])}</strong>
          </div>
        </div>
      </article>
    `);
  });
});
setHTML(
  "technicalCards",
  cards.join("") ||
  '<div class="loading-card">Technical data unavailable.</div>'
);

}

function renderOptions(data) {
const options = data.options || {};

setText("pcrValue", fmt(options.pcr));
setText("nearAtmPcr", fmt(options.zone_pcr));
setText("atmStrike", fmt(options.atm, 0));
setText("supportValue", fmt(options.support, 0));
setText("resistanceValue", fmt(options.resistance, 0));
setText(
  "pcrLabel",
  number(options.pcr) === null
    ? "Options data unavailable"
    : options.pcr > 1.2
      ? "Put OI is relatively higher"
      : options.pcr < 0.8
        ? "Call OI is relatively higher"
        : "Put-call ratio is near balanced"
);
setText(
  "optionsSource",
  `Source: ${options.source || "—"}`
);
const optionRows = [
  {
    title: "Call Option (CE)",
    data: options.ce || {},
    kind: "positive"
  },
  {
    title: "Put Option (PE)",
    data: options.pe || {},
    kind: "negative"
  }
];
setHTML(
  "optionsCards",
  optionRows.map(row => `
    <article class="panel option-card">
      <div class="option-card-head">
        <strong>${row.title}</strong>
        <span class="badge ${row.kind}">
          ${esc(row.data.buildup || "—")}
        </span>
      </div>
      <div class="technical-metrics">
        <div>
          <small>LTP</small>
          <strong>${fmt(row.data.ltp)}</strong>
        </div>
        <div>
          <small>LTP Change</small>
          <strong class="${tone(row.data.ltpch)}">
            ${fmt(row.data.ltpch)}
          </strong>
        </div>
        <div>
          <small>Open Interest</small>
          <strong>${compact(row.data.oi)}</strong>
        </div>
        <div>
          <small>OI Change</small>
          <strong class="${tone(row.data.oich)}">
            ${compact(row.data.oich)}
          </strong>
        </div>
      </div>
    </article>
  `).join("")
);

}

function renderGlobal(data) {
const markets = array(data.global_markets);

const html = markets.map(market => `
  <article class="panel global-card">
    <div class="global-card-head">
      <strong>${esc(market.name || market.ticker || "Market")}</strong>
      <span class="badge">
        ${esc(market.category || "Global")}
      </span>
    </div>
    <div class="global-price">
      ${fmt(market.price)}
    </div>
    <div class="global-change ${tone(market.change_pct)}">
      ${pct(market.change_pct)}
    </div>
  </article>
`).join("");
setHTML(
  "globalCards",
  html || '<div class="loading-card">Global market data unavailable.</div>'
);

}

function renderWeekly(data) {
const html = INDEX_NAMES.map(name => {
const weekly = indexData(name, data).seven_day || {};
const changes = array(weekly.chg);

  const bars = changes.map(change => {
    const height = Math.max(
      8,
      Math.min(48, Math.abs(number(change) || 0) * 14)
    );
    return `
      <span
        class="mini-bar ${tone(change)}"
        style="height:${height}px"
        title="${pct(change)}">
      </span>
    `;
  }).join("");
  return `
    <article class="panel weekly-card">
      <div class="weekly-card-head">
        <strong>${esc(name)}</strong>
        <span class="${tone(weekly.net)}">
          ${pct(weekly.net)}
        </span>
      </div>
      <div class="weekly-bars">${bars}</div>
      <div class="weekly-stats">
        <span>Positive sessions <strong>${fmt(weekly.up, 0)}/7</strong></span>
        <span>High <strong>${fmt(weekly.hi, 0)}</strong></span>
        <span>Low <strong>${fmt(weekly.lo, 0)}</strong></span>
      </div>
    </article>
  `;
}).join("");
setHTML("weeklyCards", html);

}

function renderBreakdown(data) {
const components = array(data.scores?.components);

const html = components.map(component => `
  <div class="breakdown-row">
    <span>
      ${esc(component.name || "Factor")}
      <small>
        Weight ${fmt(component.weight, 0)}
        · Score ${fmt(component.score)}
      </small>
    </span>
    <strong class="${tone(component.contribution)}">
      ${fmt(component.contribution)}
    </strong>
  </div>
`).join("");
setHTML(
  "scoreBreakdown",
  html || '<div class="loading-card">Score components unavailable.</div>'
);

}

function renderNews(data) {
const news = data.news || {};
const items = array(news.items);

setHTML(
  "newsSummary",
  `
    <div class="sentiment-chip">
      <span>News sentiment score</span>
      <strong class="${tone(news.score)}">
        ${fmt(news.score)}
      </strong>
    </div>
  `
);
const html = items.slice(0, 20).map(item => `
  <article class="panel news-card">
    <div class="news-card-head">
      <span class="eyebrow">
        ${esc(item.source || "Market News")}
      </span>
      <span class="news-age">
        ${item.age != null ? `${fmt(item.age, 1)}h ago` : ""}
      </span>
    </div>
    <a
      href="${esc(item.url || "#")}"
      target="_blank"
      rel="noopener noreferrer">
      ${esc(item.title || "Untitled headline")}
    </a>
  </article>
`).join("");
setHTML(
  "newsCards",
  html || '<div class="loading-card">No news headlines available.</div>'
);

}

function chartOptions(element, height) {
return {
width: Math.max(280, element.clientWidth || 320),
height,
layout: {
background: { color: “transparent” },
textColor: “#94a3b8”
},
grid: {
vertLines: { color: “rgba(148,163,184,.1)” },
horzLines: { color: “rgba(148,163,184,.1)” }
},
timeScale: {
timeVisible: true,
secondsVisible: false
}
};
}

function chartTimestamp(candle) {
if (typeof candle.time === “number”) {
return candle.time;
}

if (candle.datetime) {
  const time = Math.floor(
    new Date(candle.datetime).getTime() / 1000
  );
  return Number.isFinite(time) ? time : null;
}
return null;

}

function clearCharts() {
Object.values(state.charts).forEach(chart => {
try {
chart.remove();
} catch (_) {}
});

state.charts = {};

}

function renderCharts(data) {
const index = indexData(state.selectedIndex, data);
const frame = timeframeData(index);

setText("chartInstrument", state.selectedIndex);
setText("chartPrice", fmt(frame.close));
setText("chartChange", pct(frame.chg));
const rawCandles =
  index.charts?.[state.timeframe]
  || index.charts?.Daily
  || [];
const candles = array(rawCandles)
  .map(candle => ({
    ...candle,
    time: chartTimestamp(candle)
  }))
  .filter(candle =>
    candle.time !== null &&
    ["open", "high", "low", "close"].every(
      key => number(candle[key]) !== null
    )
  )
  .sort((a, b) => a.time - b.time);
setText("candleCount", `${candles.length} candles`);
const priceElement = $("priceChart");
const volumeElement = $("volumeChart");
const rsiElement = $("rsiChart");
if (
  !window.LightweightCharts ||
  !priceElement ||
  !volumeElement ||
  !rsiElement ||
  !candles.length
) {
  setHTML("priceChart", '<div class="chart-placeholder">Chart data unavailable.</div>');
  setHTML("volumeChart", '<div class="chart-placeholder">Volume data unavailable.</div>');
  setHTML("rsiChart", '<div class="chart-placeholder">RSI data unavailable.</div>');
  return;
}
clearCharts();
priceElement.innerHTML = "";
volumeElement.innerHTML = "";
rsiElement.innerHTML = "";
const library = window.LightweightCharts;
const priceChart = library.createChart(
  priceElement,
  chartOptions(priceElement, 320)
);
const candlesSeries = priceChart.addCandlestickSeries({
  upColor: "#22c55e",
  downColor: "#ef4444",
  borderVisible: false,
  wickUpColor: "#22c55e",
  wickDownColor: "#ef4444"
});
candlesSeries.setData(
  candles.map(candle => ({
    time: candle.time,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close)
  }))
);
[
  ["sma20", "#f59e0b"],
  ["sma50", "#38bdf8"],
  ["sma100", "#c084fc"]
].forEach(([key, color]) => {
  const series = priceChart.addLineSeries({
    color,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false
  });
  series.setData(
    candles
      .filter(candle => number(candle[key]) !== null)
      .map(candle => ({
        time: candle.time,
        value: Number(candle[key])
      }))
  );
});
priceChart.timeScale().fitContent();
const volumeChart = library.createChart(
  volumeElement,
  chartOptions(volumeElement, 100)
);
const volumeSeries = volumeChart.addHistogramSeries({
  priceFormat: { type: "volume" },
  priceScaleId: ""
});
volumeSeries.setData(
  candles.map(candle => ({
    time: candle.time,
    value: Number(candle.volume) || 0,
    color: Number(candle.close) >= Number(candle.open)
      ? "rgba(34,197,94,.55)"
      : "rgba(239,68,68,.55)"
  }))
);
volumeChart.timeScale().fitContent();
const rsiChart = library.createChart(
  rsiElement,
  chartOptions(rsiElement, 110)
);
const rsiSeries = rsiChart.addLineSeries({
  color: "#a78bfa",
  lineWidth: 2,
  priceLineVisible: false
});
rsiSeries.setData(
  candles
    .filter(candle => number(candle.rsi) !== null)
    .map(candle => ({
      time: candle.time,
      value: Number(candle.rsi)
    }))
);
rsiChart.timeScale().fitContent();
state.charts = {
  price: priceChart,
  volume: volumeChart,
  rsi: rsiChart
};

}

/* PART 3 STARTS BELOW */
function renderHistory() {
const history = state.history;

const html = history.map(item => `
  <div class="history-item">
    <span>
      <strong>
        ${esc(item.generated_at_ist || item.generated_at || "Snapshot")}
      </strong>
      <small>
        ${esc(item.label || "Historical analysis")}
      </small>
    </span>
    <strong>${fmt(item.score, 1)}</strong>
  </div>
`).join("");
setHTML(
  "historyList",
  html || '<div class="loading-card">No historical snapshots available.</div>'
);

}

function renderAll(data) {
if (!data || typeof data !== “object”) {
throw new Error(“The market data file is empty or invalid.”);
}

state.data = data;
renderHeader(data);
renderOverall(data);
renderSnapshot(data);
renderTechnical(data);
renderOptions(data);
renderGlobal(data);
renderWeekly(data);
renderBreakdown(data);
renderNews(data);
renderCharts(data);

}

async function refreshDashboard() {
if (state.refreshing) return;

state.refreshing = true;
const button = $("refreshButton");
if (button) {
  button.disabled = true;
}
try {
  const data = await fetchJSON(DATA_URL);
  renderAll(data);
  try {
    const historyData = await fetchJSON(HISTORY_URL);
    state.history = Array.isArray(historyData)
      ? historyData
      : array(historyData.snapshots || historyData.history);
    renderHistory();
  } catch (historyError) {
    console.warn(
      "Historical data is unavailable:",
      historyError
    );
    state.history = [];
    renderHistory();
  }
  setText("dataStatus", "Data loaded");
} catch (error) {
  console.error("Dashboard loading failed:", error);
  setText("dataStatus", "Loading error");
  notify(
    `Could not load market data: ${error.message}`
  );
} finally {
  state.refreshing = false;
  if (button) {
    button.disabled = false;
  }
}

}

function bindControls() {
const indexSelect = $(“indexSelect”);

if (indexSelect) {
  indexSelect.addEventListener("change", () => {
    state.selectedIndex = INDEX_NAMES.includes(indexSelect.value)
      ? indexSelect.value
      : "Nifty 50";
    if (state.data) {
      renderCharts(state.data);
    }
  });
}
document.querySelectorAll("[data-timeframe]").forEach(button => {
  button.addEventListener("click", () => {
    state.timeframe = button.dataset.timeframe || "Daily";
    document.querySelectorAll("[data-timeframe]").forEach(item => {
      item.classList.toggle("active", item === button);
    });
    if (state.data) {
      renderCharts(state.data);
    }
  });
});
const refreshButton = $("refreshButton");
if (refreshButton) {
  refreshButton.addEventListener(
    "click",
    refreshDashboard
  );
}
const backToTop = $("backToTop");
if (backToTop) {
  backToTop.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });
}
window.addEventListener("resize", () => {
  Object.values(state.charts).forEach(chart => {
    const container = chart?.chartElement?.();
    if (container) {
      chart.applyOptions({
        width: Math.max(280, container.clientWidth || 320)
      });
    }
  });
});

}

document.addEventListener(“DOMContentLoaded”, () => {
bindControls();

refreshDashboard();
window.setInterval(
  refreshDashboard,
  REFRESH_INTERVAL
);

});
})();