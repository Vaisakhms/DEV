/* ============================================================
   MARKET PULSE DASHBOARD
   File: dashboard/app.js
   Compatible with:
   - dashboard/index.html
   - dashboard/data/latest.json
   - dashboard/data/history/index.json
   - Lightweight Charts 4.2.2
   ============================================================ */

(() => {
  "use strict";

  const CONFIG = {
    latestUrl: "./data/latest.json",
    historyUrl: "./data/history/index.json",
    refreshInterval: 60000,

    colors: {
      bullish: "#22c55e",
      bearish: "#ef4444",
      neutral: "#94a3b8",
      sma20: "#f59e0b",
      sma50: "#38bdf8",
      sma100: "#c084fc",
      rsi: "#a78bfa",
      grid: "rgba(148,163,184,0.15)",
      text: "#94a3b8"
    }
  };

  const state = {
    latest: null,
    history: [],
    selectedSnapshot: null,
    selectedIndex: "Nifty 50",
    selectedTimeframe: "Daily",
    priceChart: null,
    candleSeries: null,
    sma20Series: null,
    sma50Series: null,
    sma100Series: null,
    volumeChart: null,
    volumeSeries: null,
    rsiChart: null,
    rsiSeries: null,
    resizeObserver: null,
    refreshTimer: null,
    loading: false
  };

  /* ============================================================
     GENERAL HELPERS
     ============================================================ */

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  function el(id) {
    return document.getElementById(id);
  }

  function first(...values) {
    return values.find(value =>
      value !== undefined &&
      value !== null &&
      value !== ""
    );
  }

  function number(value) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return null;
    }

    const result = Number(value);

    return Number.isFinite(result) ? result : null;
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

  function signed(value, decimals = 2, suffix = "") {
    const n = number(value);

    if (n === null) return "—";

    const prefix = n > 0 ? "+" : "";

    return prefix + fmt(n, decimals) + suffix;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setText(id, value) {
    const node = typeof id === "string" ? el(id) : id;

    if (!node) return;

    node.textContent =
      value === undefined ||
      value === null ||
      value === ""
        ? "—"
        : String(value);
  }

  function setHTML(id, html) {
    const node = typeof id === "string" ? el(id) : id;

    if (node) node.innerHTML = html;
  }

  function sentiment(value) {
    const n = number(value);

    if (n === null) return "neutral";

    if (n > 0.05) return "bullish";

    if (n < -0.05) return "bearish";

    return "neutral";
  }

  function badge(label, type = "neutral") {
    return `
      <span class="sentiment-badge ${type}">
        ${escapeHtml(label)}
      </span>
    `;
  }

  function showEmpty(id, message) {
    setHTML(
      id,
      `<div class="loading-card">${escapeHtml(message)}</div>`
    );
  }

  function getCurrentData() {
    return state.selectedSnapshot || state.latest || {};
  }

  function getIndices(data = getCurrentData()) {
    const indices = first(
      data.indices,
      data.indexes,
      data.market_indices,
      {}
    );

    return indices && typeof indices === "object"
      ? indices
      : {};
  }

  function getIndex(name, data = getCurrentData()) {
    const indices = getIndices(data);

    if (indices[name]) return indices[name];

    const keys = Object.keys(indices);

    const key = keys.find(k => {
      const text = k.toLowerCase();

      if (name === "Nifty 50") {
        return (
          text.includes("nifty") &&
          !text.includes("bank") &&
          !text.includes("midcap")
        );
      }

      if (name === "Bank Nifty") {
        return text.includes("bank") && text.includes("nifty");
      }

      if (name === "Nifty Midcap") {
        return text.includes("midcap");
      }

      return false;
    });

    return key ? indices[key] : {};
  }

  function getTimeframe(indexData, timeframe = state.selectedTimeframe) {
    const frames = first(
      indexData.timeframes,
      indexData.time_frames,
      {}
    );

    if (!frames || typeof frames !== "object") return {};

    if (frames[timeframe]) return frames[timeframe];

    const aliases = {
      "15m": ["15min", "15_min"],
      "30m": ["30min", "30_min"],
      "1h": ["60m", "1hr", "60min"],
      "Daily": ["daily", "1d", "D"]
    };

    for (const alias of aliases[timeframe] || []) {
      if (frames[alias]) return frames[alias];
    }

    return {};
  }

  function getChartCandles(indexData, timeframe) {
    const charts = first(
      indexData.charts,
      indexData.chart,
      {}
    );

    return Array.isArray(charts[timeframe])
      ? charts[timeframe]
      : [];
  }

  function timestamp(data = getCurrentData()) {
    return first(
      data.generated_at_ist,
      data.generated_at,
      data.updated_at,
      data.timestamp,
      data.date
    );
  }

  function formatTimestamp(value) {
    if (!value) return "Unavailable";

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
    const response = await fetch(
      url + "?_=" + Date.now(),
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Unable to load ${url}: HTTP ${response.status}`
      );
    }

    return response.json();
  }

  function updateStatus(message, type = "success") {
    setText("dataStatus", message);

    const status = el("dataStatus");

    if (status) {
      status.dataset.status = type;
      status.classList.toggle("is-error", type === "error");
      status.classList.toggle("is-success", type === "success");
    }
  }

  /* ============================================================
     HEADER AND OVERALL MARKET SCORE
     ============================================================ */

  function renderHeader(data) {
    const marketStatus = first(
      data.market_status,
      data.marketStatus,
      "Market status unavailable"
    );

    setText("marketStatus", marketStatus);

    const time = formatTimestamp(timestamp(data));

    setText("lastUpdated", time);
    setText("dataTimestamp", time);

    setText(
      "sessionSummary",
      marketStatus
    );
  }

  function renderOverall(data) {
    const overall = first(data.overall, {});

    const rawScore = number(overall.score);

    const label = first(
      overall.label,
      "Market bias unavailable"
    );

    const coverage = number(
      first(
        overall.coverage_pct,
        overall.coverage,
        0
      )
    );

    setText(
      "overallScore",
      rawScore === null ? "—" : fmt(rawScore, 1)
    );

    setText("overallLabel", label);

    setText(
      "scoreGaugeValue",
      rawScore === null ? "—" : fmt(rawScore, 1)
    );

    setText(
      "coverageValue",
      coverage === null ? "—" : fmt(coverage, 0) + "%"
    );

    const coverageFill = el("coverageFill");

    if (coverageFill) {
      coverageFill.style.width =
        Math.max(0, Math.min(100, coverage || 0)) + "%";
    }

    /*
      The overall score in the JSON is a weighted score.
      Use its numeric value for the gauge without inventing
      a different score.
    */

    const scoreFill = el("scoreTrackFill");

    if (scoreFill) {
      const gaugeWidth = rawScore === null
        ? 0
        : Math.max(0, Math.min(100, rawScore));

      scoreFill.style.width = gaugeWidth + "%";
    }

    const gauge = el("scoreGauge");

    if (gauge) {
      const gaugeValue = rawScore === null
        ? 0
        : Math.max(0, Math.min(100, rawScore));

      gauge.style.background =
        `conic-gradient(
          ${CONFIG.colors.bullish} ${gaugeValue}%,
          ${CONFIG.colors.grid} ${gaugeValue}%
        )`;
    }

    setText(
      "scoreNote",
      `Analysis coverage: ${fmt(coverage, 0)}%. ` +
      `Last updated: ${formatTimestamp(timestamp(data))}`
    );
  }

  /* ============================================================
     MARKET SNAPSHOT
     ============================================================ */

  function renderSnapshot(data) {
    const indices = getIndices(data);

    const names = [
      "Nifty 50",
      "Bank Nifty",
      "Nifty Midcap"
    ];

    const cards = names.map(name => {
      const indexData = getIndex(name, data);

      const frames = first(indexData.timeframes, {});

      const daily = first(
        frames.Daily,
        frames.daily,
        frames["1d"],
        {}
      );

      const intraday = first(
        frames["15m"],
        frames["30m"],
        {}
      );

      const close = first(
        daily.close,
        intraday.close,
        indexData.close,
        indexData.price
      );

      const change = first(
        daily.chg,
        daily.change_pct,
        daily.change,
        intraday.chg,
        indexData.change_pct
      );

      const changeNumber = number(change);

      const direction = sentiment(
        changeNumber === null ? 0 : changeNumber
      );

      const title = name;

      const trend = first(
        daily.label,
        intraday.label,
        indexData.label,
        direction === "bullish"
          ? "Positive"
          : direction === "bearish"
            ? "Negative"
            : "Neutral"
      );

      return `
        <article class="panel index-card">
          <div class="index-card-top">
            <span class="index-name">
              ${escapeHtml(title)}
            </span>
            ${badge(trend, direction)}
          </div>

          <div class="index-price">
            ${fmt(close)}
          </div>

          <div class="index-change ${direction}">
            ${signed(changeNumber, 2, "%")}
          </div>

          <div class="index-card-footer">
            <span>Daily change</span>
            <span>
              ${close === undefined ? "No data" : "Latest snapshot"}
            </span>
          </div>
        </article>
      `;
    });

    if (!Object.keys(indices).length) {
      showEmpty("indexCards", "No index data available.");
      return;
    }

    setHTML("indexCards", cards.join(""));
  }

  /* ============================================================
     PART 2 CONTINUES BELOW
     ============================================================ */
  /* ============================================================
     CHART DATA HELPERS
     ============================================================ */

  function findContainer(ids) {
    for (const id of ids) {
      const node = el(id);
      if (node) return node;
    }

    return null;
  }

  function renderInto(ids, html, emptyMessage = "No data available.") {
    const node = findContainer(ids);

    if (!node) {
      console.warn("Dashboard container not found:", ids);
      return false;
    }

    node.innerHTML = html || `
      <div class="loading-card">
        ${escapeHtml(emptyMessage)}
      </div>
    `;

    return true;
  }

  function getTechnicalData(indexData, timeframe) {
    const frame = getTimeframe(indexData, timeframe);

    return first(
      frame.technical,
      frame.indicators,
      frame.technicals,
      indexData.technical,
      indexData.indicators,
      {}
    );
  }

  function getCandles(indexData, timeframe) {
    const frame = getTimeframe(indexData, timeframe);

    const candidates = [
      frame.candles,
      frame.ohlc,
      frame.history,
      frame.data,
      frame.prices,
      indexData.candles,
      indexData.ohlc,
      getChartCandles(indexData, timeframe)
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length) {
        return candidate;
      }
    }

    return [];
  }

  function candleValue(candle, keys) {
    for (const key of keys) {
      if (
        candle &&
        candle[key] !== undefined &&
        candle[key] !== null
      ) {
        return candle[key];
      }
    }

    return null;
  }

  function normalizeCandles(rawCandles) {
    return rawCandles
      .map(candle => {
        const rawTime = candleValue(candle, [
          "time",
          "timestamp",
          "datetime",
          "date",
          "t"
        ]);

        let time = rawTime;

        if (typeof rawTime === "string") {
          const parsed = Date.parse(rawTime);

          if (Number.isFinite(parsed)) {
            time = Math.floor(parsed / 1000);
          }
        } else if (typeof rawTime === "number") {
          /*
            Epoch timestamps may be in milliseconds.
            Convert them to seconds for Lightweight Charts.
          */
          if (rawTime > 100000000000) {
            time = Math.floor(rawTime / 1000);
          }
        }

        const open = number(candleValue(candle, [
          "open", "o"
        ]));

        const high = number(candleValue(candle, [
          "high", "h"
        ]));

        const low = number(candleValue(candle, [
          "low", "l"
        ]));

        const close = number(candleValue(candle, [
          "close", "c"
        ]));

        const volume = number(candleValue(candle, [
          "volume", "vol", "v"
        ]));

        if (
          time === null ||
          time === undefined ||
          open === null ||
          high === null ||
          low === null ||
          close === null
        ) {
          return null;
        }

        return {
          time,
          open,
          high,
          low,
          close,
          volume
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const ta = typeof a.time === "number"
          ? a.time
          : Date.parse(a.time);

        const tb = typeof b.time === "number"
          ? b.time
          : Date.parse(b.time);

        return ta - tb;
      });
  }

  function getSMAValues(candles, period) {
    const result = [];
    const closes = candles.map(c => c.close);

    for (let i = period - 1; i < closes.length; i++) {
      const window = closes.slice(i - period + 1, i + 1);

      const average =
        window.reduce((sum, value) => sum + value, 0) /
        period;

      result.push({
        time: candles[i].time,
        value: average
      });
    }

    return result;
  }

  function getRSIValues(candles, period = 14) {
    const result = [];

    if (candles.length <= period) {
      return result;
    }

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change =
        candles[i].close - candles[i - 1].close;

      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    let averageGain = gains / period;
    let averageLoss = losses / period;

    function calculateRSI(gain, loss) {
      if (loss === 0) return 100;

      const rs = gain / loss;

      return 100 - 100 / (1 + rs);
    }

    result.push({
      time: candles[period].time,
      value: calculateRSI(averageGain, averageLoss)
    });

    for (let i = period + 1; i < candles.length; i++) {
      const change =
        candles[i].close - candles[i - 1].close;

      const gain = Math.max(change, 0);
      const loss = Math.max(-change, 0);

      averageGain =
        (averageGain * (period - 1) + gain) / period;

      averageLoss =
        (averageLoss * (period - 1) + loss) / period;

      result.push({
        time: candles[i].time,
        value: calculateRSI(averageGain, averageLoss)
      });
    }

    return result;
  }

  function getVolumeValues(candles) {
    return candles
      .filter(c => c.volume !== null)
      .map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open
          ? CONFIG.colors.bullish
          : CONFIG.colors.bearish
      }));
  }

  /* ============================================================
     CHART LIFECYCLE
     ============================================================ */

  function removeChart(chart) {
    if (!chart) return;

    try {
      chart.remove();
    } catch (error) {
      console.warn("Could not remove chart:", error);
    }
  }

  function createChart(container, options = {}) {
    if (!container) return null;

    if (!window.LightweightCharts) {
      console.error(
        "Lightweight Charts library is not available."
      );

      container.innerHTML = `
        <div class="loading-card">
          Chart library could not be loaded.
          Check your internet connection and the chart script URL.
        </div>
      `;

      return null;
    }

    return LightweightCharts.createChart(container, {
      width: Math.max(container.clientWidth, 280),
      height: options.height || 280,

      layout: {
        background: {
          type: "solid",
          color: "transparent"
        },
        textColor: CONFIG.colors.text,
        fontSize: 11
      },

      grid: {
        vertLines: {
          color: CONFIG.colors.grid
        },
        horzLines: {
          color: CONFIG.colors.grid
        }
      },

      rightPriceScale: {
        borderColor: CONFIG.colors.grid
      },

      timeScale: {
        borderColor: CONFIG.colors.grid,
        timeVisible: true,
        secondsVisible: false
      },

      crosshair: {
        vertLine: {
          color: "#64748b",
          width: 1,
          style: 2,
          labelBackgroundColor: "#334155"
        },
        horzLine: {
          color: "#64748b",
          width: 1,
          style: 2,
          labelBackgroundColor: "#334155"
        }
      },

      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false
      },

      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true
      },

      ...options
    });
  }

  function addCandlestickSeries(chart) {
    /*
      Lightweight Charts 4.x uses addCandlestickSeries().
      The fallback also supports the newer addSeries API.
    */
    if (typeof chart.addCandlestickSeries === "function") {
      return chart.addCandlestickSeries({
        upColor: CONFIG.colors.bullish,
        downColor: CONFIG.colors.bearish,
        borderUpColor: CONFIG.colors.bullish,
        borderDownColor: CONFIG.colors.bearish,
        wickUpColor: CONFIG.colors.bullish,
        wickDownColor: CONFIG.colors.bearish
      });
    }

    if (
      window.LightweightCharts &&
      typeof chart.addSeries === "function" &&
      LightweightCharts.CandlestickSeries
    ) {
      return chart.addSeries(
        LightweightCharts.CandlestickSeries,
        {
          upColor: CONFIG.colors.bullish,
          downColor: CONFIG.colors.bearish,
          borderUpColor: CONFIG.colors.bullish,
          borderDownColor: CONFIG.colors.bearish,
          wickUpColor: CONFIG.colors.bullish,
          wickDownColor: CONFIG.colors.bearish
        }
      );
    }

    return null;
  }

  function addLineSeries(chart, color, title) {
    const options = {
      color,
      lineWidth: 2,
      title,
      priceLineVisible: false,
      lastValueVisible: true
    };

    if (typeof chart.addLineSeries === "function") {
      return chart.addLineSeries(options);
    }

    if (
      window.LightweightCharts &&
      typeof chart.addSeries === "function" &&
      LightweightCharts.LineSeries
    ) {
      return chart.addSeries(
        LightweightCharts.LineSeries,
        options
      );
    }

    return null;
  }

  function addHistogramSeries(chart) {
    if (typeof chart.addHistogramSeries === "function") {
      return chart.addHistogramSeries({
        priceFormat: {
          type: "volume"
        },
        priceScaleId: ""
      });
    }

    if (
      window.LightweightCharts &&
      typeof chart.addSeries === "function" &&
      LightweightCharts.HistogramSeries
    ) {
      return chart.addSeries(
        LightweightCharts.HistogramSeries,
        {
          priceFormat: {
            type: "volume"
          },
          priceScaleId: ""
        }
      );
    }

    return null;
  }

  /* ============================================================
     PRICE ACTION
     ============================================================ */

  function renderPriceAction() {
    const data = getCurrentData();

    const indexData = getIndex(
      state.selectedIndex,
      data
    );

    const timeframe = state.selectedTimeframe;

    const rawCandles = getCandles(
      indexData,
      timeframe
    );

    const candles = normalizeCandles(rawCandles);

    const chartContainer = findContainer([
      "priceChart",
      "candlestickChart",
      "mainChart",
      "chartContainer"
    ]);

    if (!chartContainer) {
      console.warn(
        "Price chart container not found. " +
        "Expected priceChart, candlestickChart, " +
        "mainChart or chartContainer."
      );

      return;
    }

    if (!candles.length) {
      chartContainer.innerHTML = `
        <div class="loading-card">
          No candlestick data is available for
          ${escapeHtml(state.selectedIndex)}
          (${escapeHtml(timeframe)}).
        </div>
      `;

      removeChart(state.priceChart);
      removeChart(state.volumeChart);
      removeChart(state.rsiChart);

      state.priceChart = null;
      state.volumeChart = null;
      state.rsiChart = null;

      return;
    }

    chartContainer.innerHTML = "";

    removeChart(state.priceChart);

    state.priceChart = createChart(
      chartContainer,
      {
        height: window.innerWidth < 600 ? 280 : 360
      }
    );

    if (!state.priceChart) return;

    state.candleSeries = addCandlestickSeries(
      state.priceChart
    );

    if (!state.candleSeries) {
      chartContainer.innerHTML = `
        <div class="loading-card">
          Unable to initialize the candlestick chart.
        </div>
      `;

      return;
    }

    state.candleSeries.setData(
      candles.map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
      }))
    );

    const sma20 = getSMAValues(candles, 20);
    const sma50 = getSMAValues(candles, 50);
    const sma100 = getSMAValues(candles, 100);

    state.sma20Series = addLineSeries(
      state.priceChart,
      CONFIG.colors.sma20,
      "SMA 20"
    );

    state.sma50Series = addLineSeries(
      state.priceChart,
      CONFIG.colors.sma50,
      "SMA 50"
    );

    state.sma100Series = addLineSeries(
      state.priceChart,
      CONFIG.colors.sma100,
      "SMA 100"
    );

    if (state.sma20Series) {
      state.sma20Series.setData(sma20);
    }

    if (state.sma50Series) {
      state.sma50Series.setData(sma50);
    }

    if (state.sma100Series) {
      state.sma100Series.setData(sma100);
    }

    state.priceChart.timeScale().fitContent();

    renderChartSummary(candles, sma20, sma50, sma100);

    renderVolumeChart(candles);
    renderRSIChart(candles);

    setTimeout(() => {
      if (!state.priceChart) return;

      const width = chartContainer.clientWidth;

      if (width > 0) {
        state.priceChart.applyOptions({
          width
        });
      }
    }, 100);
  }

  function renderChartSummary(candles, sma20, sma50, sma100) {
    const latest = candles[candles.length - 1];

    const previous = candles.length > 1
      ? candles[candles.length - 2]
      : null;

    const change = previous
      ? ((latest.close - previous.close) / previous.close) * 100
      : null;

    setText("chartIndexName", state.selectedIndex);
    setText("chartTimeframe", state.selectedTimeframe);
    setText("chartLastPrice", fmt(latest.close));
    setText("chartChange", signed(change, 2, "%"));
    setText("chartHigh", fmt(latest.high));
    setText("chartLow", fmt(latest.low));

    setText(
      "chartSMA20",
      sma20.length ? fmt(sma20[sma20.length - 1].value) : "—"
    );

    setText(
      "chartSMA50",
      sma50.length ? fmt(sma50[sma50.length - 1].value) : "—"
    );

    setText(
      "chartSMA100",
      sma100.length ? fmt(sma100[sma100.length - 1].value) : "—"
    );
  }

  /* ============================================================
     VOLUME CHART
     ============================================================ */

  function renderVolumeChart(candles) {
    const container = findContainer([
      "volumeChart",
      "volumeChartContainer"
    ]);

    if (!container) return;

    removeChart(state.volumeChart);
    state.volumeChart = null;

    const volumes = getVolumeValues(candles);

    if (!volumes.length) {
      container.innerHTML = `
        <div class="loading-card">
          Volume data is unavailable.
        </div>
      `;

      return;
    }

    container.innerHTML = "";

    state.volumeChart = createChart(
      container,
      {
        height: 130,
        timeScale: {
          visible: false,
          borderColor: CONFIG.colors.grid
        }
      }
    );

    if (!state.volumeChart) return;

    state.volumeSeries = addHistogramSeries(
      state.volumeChart
    );

    if (!state.volumeSeries) return;

    state.volumeSeries.setData(volumes);

    state.volumeChart.timeScale().fitContent();
  }

  /* ============================================================
     RSI CHART
     ============================================================ */

  function renderRSIChart(candles) {
    const container = findContainer([
      "rsiChart",
      "rsiChartContainer"
    ]);

    if (!container) return;

    removeChart(state.rsiChart);
    state.rsiChart = null;

    const rsi = getRSIValues(candles, 14);

    if (!rsi.length) {
      container.innerHTML = `
        <div class="loading-card">
          RSI requires at least 15 candles.
        </div>
      `;

      return;
    }

    container.innerHTML = "";

    state.rsiChart = createChart(
      container,
      {
        height: 150,
        rightPriceScale: {
          borderColor: CONFIG.colors.grid,
          scaleMargins: {
            top: 0.1,
            bottom: 0.1
          }
        }
      }
    );

    if (!state.rsiChart) return;

    state.rsiSeries = addLineSeries(
      state.rsiChart,
      CONFIG.colors.rsi,
      "RSI 14"
    );

    if (!state.rsiSeries) return;

    state.rsiSeries.setData(rsi);

    state.rsiChart.timeScale().fitContent();

    const latestRSI = rsi[rsi.length - 1].value;

    let label = "Neutral";

    if (latestRSI >= 70) {
      label = "Overbought";
    } else if (latestRSI <= 30) {
      label = "Oversold";
    }

    setText("rsiValue", fmt(latestRSI, 1));
    setText("rsiSignal", label);
  }

  /* ============================================================
     INDEX AND TIMEFRAME SELECTORS
     ============================================================ */

  function bindSelectors() {
    const indexSelectors = [
      "indexSelector",
      "indexSelect",
      "marketSelector"
    ];

    const timeframeSelectors = [
      "timeframeSelector",
      "timeframeSelect",
      "chartTimeframeSelector"
    ];

    for (const id of indexSelectors) {
      const node = el(id);

      if (!node || node.dataset.bound === "true") continue;

      node.dataset.bound = "true";

      node.addEventListener("change", event => {
        const value = event.target.value;

        if (value) {
          state.selectedIndex = value;
          renderPriceAction();
          renderTrendAnalysis();
        }
      });
    }

    for (const id of timeframeSelectors) {
      const node = el(id);

      if (!node || node.dataset.bound === "true") continue;

      node.dataset.bound = "true";

      node.addEventListener("change", event => {
        const value = event.target.value;

        if (value) {
          state.selectedTimeframe = value;
          renderPriceAction();
          renderTrendAnalysis();
        }
      });
    }
  }

  /* ============================================================
     TREND ANALYSIS
     ============================================================ */

  function renderTrendAnalysis() {
    const data = getCurrentData();

    const indexData = getIndex(
      state.selectedIndex,
      data
    );

    const frame = getTimeframe(
      indexData,
      state.selectedTimeframe
    );

    const technical = getTechnicalData(
      indexData,
      state.selectedTimeframe
    );

    const candles = normalizeCandles(
      getCandles(indexData, state.selectedTimeframe)
    );

    const last = candles.length
      ? candles[candles.length - 1]
      : null;

    const sma20 = number(first(
      technical.sma20,
      technical.sma_20,
      technical.SMA20,
      technical.SMA_20
    ));

    const sma50 = number(first(
      technical.sma50,
      technical.sma_50,
      technical.SMA50,
      technical.SMA_50
    ));

    const sma100 = number(first(
      technical.sma100,
      technical.sma_100,
      technical.SMA100,
      technical.SMA_100
    ));

    const rsi = number(first(
      technical.rsi,
      technical.RSI,
      technical.rsi14,
      technical.rsi_14
    ));

    const price = number(first(
      frame.close,
      frame.price,
      last ? last.close : null,
      indexData.close,
      indexData.price
    ));

    const calculatedSMA20 = candles.length >= 20
      ? getSMAValues(candles, 20).slice(-1)[0]?.value
      : null;

    const calculatedSMA50 = candles.length >= 50
      ? getSMAValues(candles, 50).slice(-1)[0]?.value
      : null;

    const calculatedSMA100 = candles.length >= 100
      ? getSMAValues(candles, 100).slice(-1)[0]?.value
      : null;

    const finalSMA20 = sma20 ?? calculatedSMA20;
    const finalSMA50 = sma50 ?? calculatedSMA50;
    const finalSMA100 = sma100 ?? calculatedSMA100;

    const finalRSI = rsi ??
      (
        candles.length > 14
          ? getRSIValues(candles).slice(-1)[0]?.value
          : null
      );

    const smaSignal = (average, label) => {
      if (price === null || average === null || average === undefined) {
        return {
          value: "Unavailable",
          type: "neutral",
          detail: `${label} data unavailable`
        };
      }

      const bullish = price > average;

      return {
        value: bullish ? "Bullish" : "Bearish",
        type: bullish ? "bullish" : "bearish",
        detail: `Price ${bullish ? "above" : "below"} ${label}`
      };
    };

    const cards = [
      {
        title: "Current Price",
        value: fmt(price),
        type: "neutral",
        detail: state.selectedIndex
      },
      {
        title: "SMA 20",
        value: fmt(finalSMA20),
        ...smaSignal(finalSMA20, "SMA 20")
      },
      {
        title: "SMA 50",
        value: fmt(finalSMA50),
        ...smaSignal(finalSMA50, "SMA 50")
      },
      {
        title: "SMA 100",
        value: fmt(finalSMA100),
        ...smaSignal(finalSMA100, "SMA 100")
      },
      {
        title: "RSI 14",
        value: finalRSI === null || finalRSI === undefined
          ? "—"
          : fmt(finalRSI, 1),
        type: finalRSI >= 70
          ? "bearish"
          : finalRSI <= 30
            ? "bullish"
            : "neutral",
        detail: finalRSI >= 70
          ? "Overbought zone"
          : finalRSI <= 30
            ? "Oversold zone"
            : "Momentum indicator"
      }
    ];

    const html = cards.map(card => `
      <article class="panel technical-card">
        <div class="technical-title">
          ${escapeHtml(card.title)}
        </div>

        <div class="technical-value ${card.type}">
          ${escapeHtml(card.value)}
        </div>

        <div class="technical-detail">
          ${escapeHtml(card.detail || "")}
        </div>
      </article>
    `).join("");

    renderInto(
      [
        "technicalCards",
        "trendCards",
        "trendAnalysis",
        "technicalIndicators"
      ],
      html,
      "Technical indicators are not available."
    );
  }

  /* ============================================================
     OPTIONS INTELLIGENCE
     ============================================================ */

  function getOptionsData(data = getCurrentData()) {
    return first(
      data.options,
      data.option_chain,
      data.optionChain,
      data.options_data,
      data.options_intelligence,
      {}
    );
  }

  function renderOptions() {
    const options = getOptionsData();

    const pcr = number(first(
      options.pcr,
      options.put_call_ratio,
      options.putCallRatio
    ));

    const callOI = number(first(
      options.call_oi,
      options.callOI,
      options.total_call_oi
    ));

    const putOI = number(first(
      options.put_oi,
      options.putOI,
      options.total_put_oi
    ));

    const maxPain = first(
      options.max_pain,
      options.maxPain,
      options.max_pain_strike
    );

    const support = first(
      options.support,
      options.support_level,
      options.support_levels
    );

    const resistance = first(
      options.resistance,
      options.resistance_level,
      options.resistance_levels
    );

    const oiChange = first(
      options.oi_change,
      options.oiChange,
      options.change_in_oi
    );

    const optionCards = [
      {
        title: "Put/Call Ratio",
        value: pcr === null ? "—" : fmt(pcr, 2),
        detail: pcr === null
          ? "PCR unavailable"
          : pcr > 1
            ? "Put OI exceeds Call OI"
            : pcr < 1
              ? "Call OI exceeds Put OI"
              : "Put/Call OI balanced",
        type: pcr === null
          ? "neutral"
          : pcr > 1
            ? "bullish"
            : pcr < 1
              ? "bearish"
              : "neutral"
      },
      {
        title: "Call Open Interest",
        value: callOI === null ? "—" : compact(callOI),
        detail: "Reported Call OI",
        type: "bearish"
      },
      {
        title: "Put Open Interest",
        value: putOI === null ? "—" : compact(putOI),
        detail: "Reported Put OI",
        type: "bullish"
      },
      {
        title: "Max Pain",
        value: maxPain === undefined ? "—" : fmt(maxPain, 0),
        detail: "Reported maximum-pain level",
        type: "neutral"
      },
      {
        title: "Support",
        value: Array.isArray(support)
          ? support.map(v => fmt(v, 0)).join(", ")
          : support === undefined
            ? "—"
            : fmt(support, 0),
        detail: "Reported support level(s)",
        type: "bullish"
      },
      {
        title: "Resistance",
        value: Array.isArray(resistance)
          ? resistance.map(v => fmt(v, 0)).join(", ")
          : resistance === undefined
            ? "—"
            : fmt(resistance, 0),
        detail: "Reported resistance level(s)",
        type: "bearish"
      }
    ];

    const html = optionCards.map(card => `
      <article class="panel option-card">
        <div class="option-title">
          ${escapeHtml(card.title)}
        </div>

        <div class="option-value ${card.type}">
          ${escapeHtml(card.value)}
        </div>

        <div class="option-detail">
          ${escapeHtml(card.detail)}
        </div>
      </article>
    `).join("");

    const hasOptions = [
      pcr,
      callOI,
      putOI,
      number(maxPain),
      number(support),
      number(resistance)
    ].some(value => value !== null);

    renderInto(
      [
        "optionsCards",
        "optionsGrid",
        "optionsIntelligence",
        "optionCards"
      ],
      hasOptions ? html : "",
      "Options data is unavailable in the latest snapshot."
    );

    setText(
      "optionsPCR",
      pcr === null ? "—" : fmt(pcr, 2)
    );

    setText(
      "optionsCallOI",
      callOI === null ? "—" : compact(callOI)
    );

    setText(
      "optionsPutOI",
      putOI === null ? "—" : compact(putOI)
    );

    setText(
      "optionsMaxPain",
      maxPain === undefined ? "—" : fmt(maxPain, 0)
    );

    setText(
      "optionsOIChange",
      oiChange === undefined ? "—" : JSON.stringify(oiChange)
    );
  }

  /* ============================================================
     INTERNATIONAL PULSE
     ============================================================ */

  function getGlobalData(data = getCurrentData()) {
    return first(
      data.global_markets,
      data.globalMarkets,
      data.global_indices,
      data.global,
      data.international_markets,
      {}
    );
  }

  function renderGlobalMarkets() {
    const global = getGlobalData();

    let entries = [];

    if (Array.isArray(global)) {
      entries = global.map((item, index) => [
        first(item.name, item.symbol, item.ticker, `Market ${index + 1}`),
        item
      ]);
    } else if (global && typeof global === "object") {
      entries = Object.entries(global);
    }

    const html = entries.map(([name, item]) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      const price = first(
        item.price,
        item.close,
        item.last,
        item.value
      );

      const change = number(first(
        item.change_pct,
        item.changePercent,
        item.percent_change,
        item.chg,
        item.change
      ));

      const direction = sentiment(change);

      return `
        <article class="panel global-card">
          <div class="global-card-top">
            <span class="global-name">
              ${escapeHtml(name)}
            </span>

            ${badge(
              direction === "bullish"
                ? "Positive"
                : direction === "bearish"
                  ? "Negative"
                  : "Neutral",
              direction
            )}
          </div>

          <div class="global-price">
            ${fmt(price)}
          </div>

          <div class="global-change ${direction}">
            ${signed(change, 2, "%")}
          </div>
        </article>
      `;
    }).filter(Boolean);

    renderInto(
      [
        "globalCards",
        "globalMarkets",
        "internationalCards",
        "internationalPulse"
      ],
      html.join(""),
      "Global-market data is unavailable."
    );
  }

  /* ============================================================
     SEVEN-SESSION TREND
     ============================================================ */

  function getHistoryEntries() {
    const history = state.history;

    if (Array.isArray(history)) {
      return history;
    }

    if (history && typeof history === "object") {
      const entries = first(
        history.history,
        history.snapshots,
        history.items,
        history.data
      );

      if (Array.isArray(entries)) return entries;

      return Object.values(history);
    }

    return [];
  }

  function historyEntryDate(item) {
    return first(
      item.generated_at_ist,
      item.generated_at,
      item.timestamp,
      item.date,
      item.updated_at
    );
  }

  function renderWeeklyTrend() {
    const entries = getHistoryEntries();

    const unique = new Map();

    for (const item of entries) {
      if (!item || typeof item !== "object") continue;

      const date = historyEntryDate(item);

      if (date) unique.set(String(date), item);
    }

    const snapshots = Array.from(unique.values())
      .sort((a, b) => {
        return new Date(historyEntryDate(a)) -
          new Date(historyEntryDate(b));
      })
      .slice(-7);

    if (
      state.latest &&
      !snapshots.some(item =>
        historyEntryDate(item) === timestamp(state.latest)
      )
    ) {
      snapshots.push(state.latest);
    }

    const rows = snapshots.slice(-7).map(item => {
      const overall = first(item.overall, {});

      const score = number(overall.score);

      const date = historyEntryDate(item);

      return {
        date,
        score,
        label: first(overall.label, "Unavailable")
      };
    });

    const html = rows.map(row => {
      const date = row.date
        ? new Date(row.date).toLocaleDateString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short"
          })
        : "—";

      const type = row.score === null
        ? "neutral"
        : row.score > 0
          ? "bullish"
          : row.score < 0
            ? "bearish"
            : "neutral";

      return `
        <article class="panel weekly-card">
          <div class="weekly-date">
            ${escapeHtml(date)}
          </div>

          <div class="weekly-score ${type}">
            ${row.score === null ? "—" : fmt(row.score, 1)}
          </div>

          <div class="weekly-label">
            ${escapeHtml(row.label)}
          </div>
        </article>
      `;
    }).join("");

    renderInto(
      [
        "weeklyCards",
        "weeklyTrend",
        "sevenSessionTrend",
        "historyCards"
      ],
      html,
      "Historical snapshots are not available yet."
    );
  }

  /* ============================================================
     SCORE BREAKDOWN
     ============================================================ */

  function getScoreBreakdown(data = getCurrentData()) {
    return first(
      data.score_breakdown,
      data.scoreBreakdown,
      data.score_components,
      data.components,
      data.factors,
      {}
    );
  }

  function renderScoreBreakdown() {
    const breakdown = getScoreBreakdown();

    let entries = [];

    if (Array.isArray(breakdown)) {
      entries = breakdown.map((item, index) => [
        first(item.name, item.label, `Factor ${index + 1}`),
        item
      ]);
    } else if (
      breakdown &&
      typeof breakdown === "object"
    ) {
      entries = Object.entries(breakdown);
    }

    const html = entries.map(([name, item]) => {
      const value = typeof item === "object" && item !== null
        ? number(first(
            item.score,
            item.value,
            item.weighted_score,
            item.contribution
          ))
        : number(item);

      const description =
        typeof item === "object" && item !== null
          ? first(item.description, item.signal, item.label, "")
          : "";

      const type = value === null
        ? "neutral"
        : value > 0
          ? "bullish"
          : value < 0
            ? "bearish"
            : "neutral";

      const width = value === null
        ? 0
        : Math.min(100, Math.abs(value));

      return `
        <article class="panel score-card">
          <div class="score-card-header">
            <span class="score-name">
              ${escapeHtml(name)}
            </span>

            <span class="score-value ${type}">
              ${value === null ? "—" : signed(value, 2)}
            </span>
          </div>

          <div class="score-bar">
            <div
              class="score-bar-fill ${type}"
              style="width:${width}%"
            ></div>
          </div>

          <div class="score-description">
            ${escapeHtml(description)}
          </div>
        </article>
      `;
    }).join("");

    renderInto(
      [
        "scoreBreakdown",
        "scoreBreakdownCards",
        "factorCards",
        "scoreCards"
      ],
      html,
      "Score breakdown is unavailable in the latest snapshot."
    );
  }

  /* ============================================================
     END OF PART 2
     PART 3 CONTINUES WITH NEWS, REFRESH,
     INITIALIZATION AND ERROR HANDLING.
     ============================================================ */
  /* ============================================================
     NEWS AND MARKET SENTIMENT
     ============================================================ */

  function getNewsData(data = getCurrentData()) {
    return first(
      data.news,
      data.news_items,
      data.newsItems,
      data.headlines,
      data.market_news,
      data.sentiment_data,
      []
    );
  }

  function renderNews() {
    const data = getCurrentData();
    const news = getNewsData(data);

    let entries = [];

    if (Array.isArray(news)) {
      entries = news;
    } else if (news && typeof news === "object") {
      const items = first(
        news.items,
        news.articles,
        news.headlines,
        news.results
      );

      if (Array.isArray(items)) {
        entries = items;
      } else {
        entries = Object.values(news).filter(
          item => item && typeof item === "object"
        );
      }
    }

    const html = entries.map(item => {
      if (!item || typeof item !== "object") {
        return "";
      }

      const title = first(
        item.title,
        item.headline,
        item.name,
        "Untitled news item"
      );

      const summary = first(
        item.summary,
        item.description,
        item.snippet,
        item.content,
        ""
      );

      const source = first(
        item.source,
        item.publisher,
        item.domain,
        "News"
      );

      const published = first(
        item.published,
        item.published_at,
        item.publishedAt,
        item.date,
        item.timestamp
      );

      const url = first(
        item.url,
        item.link,
        item.article_url,
        ""
      );

      const score = number(first(
        item.sentiment_score,
        item.sentimentScore,
        item.score
      ));

      const sentimentLabel = first(
        item.sentiment,
        item.label,
        score === null
          ? "Neutral"
          : score > 0.05
            ? "Positive"
            : score < -0.05
              ? "Negative"
              : "Neutral"
      );

      const sentimentType = sentiment(score);

      const safeUrl = isSafeExternalUrl(url)
        ? url
        : "";

      const titleHtml = safeUrl
        ? `<a href="${escapeHtml(safeUrl)}"
              target="_blank"
              rel="noopener noreferrer">
              ${escapeHtml(title)}
           </a>`
        : escapeHtml(title);

      return `
        <article class="panel news-card">
          <div class="news-card-header">
            <span class="news-source">
              ${escapeHtml(source)}
            </span>

            ${badge(
              sentimentLabel,
              sentimentType
            )}
          </div>

          <h3 class="news-title">
            ${titleHtml}
          </h3>

          ${
            summary
              ? `<p class="news-summary">
                   ${escapeHtml(summary)}
                 </p>`
              : ""
          }

          <div class="news-footer">
            <span>${escapeHtml(formatShortDate(published))}</span>

            ${
              safeUrl
                ? `<a href="${escapeHtml(safeUrl)}"
                     target="_blank"
                     rel="noopener noreferrer">
                     Read article ↗
                   </a>`
                : ""
            }
          </div>
        </article>
      `;
    }).filter(Boolean);

    renderInto(
      [
        "newsCards",
        "newsContainer",
        "newsFeed",
        "newsSentiment",
        "newsGrid"
      ],
      html.join(""),
      "No news articles are available in this snapshot."
    );

    renderNewsSummary(news);
  }

  function isSafeExternalUrl(value) {
    if (!value || typeof value !== "string") {
      return false;
    }

    try {
      const url = new URL(value, window.location.href);

      return (
        url.protocol === "https:" ||
        url.protocol === "http:"
      );
    } catch {
      return false;
    }
  }

  function formatShortDate(value) {
    if (!value) return "Date unavailable";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  }

  function renderNewsSummary(news) {
    let entries = [];

    if (Array.isArray(news)) {
      entries = news;
    } else if (news && typeof news === "object") {
      entries = first(
        news.items,
        news.articles,
        news.headlines,
        news.results,
        []
      );

      if (!Array.isArray(entries)) {
        entries = [];
      }
    }

    const scores = entries
      .map(item => number(first(
        item.sentiment_score,
        item.sentimentScore,
        item.score
      )))
      .filter(value => value !== null);

    const average = scores.length
      ? scores.reduce((sum, value) => sum + value, 0) /
        scores.length
      : null;

    let label = "Unavailable";

    if (average !== null) {
      label = average > 0.05
        ? "Positive"
        : average < -0.05
          ? "Negative"
          : "Neutral";
    }

    setText("newsSentimentValue", label);
    setText("newsCount", entries.length);

    setText(
      "newsAverageScore",
      average === null ? "—" : fmt(average, 3)
    );
  }

  /* ============================================================
     SNAPSHOT SELECTOR
     ============================================================ */

  function bindSnapshotSelector() {
    const selectors = [
      "snapshotSelector",
      "historySelector",
      "analysisSelector"
    ];

    selectors.forEach(id => {
      const node = el(id);

      if (!node || node.dataset.bound === "true") {
        return;
      }

      node.dataset.bound = "true";

      node.addEventListener("change", event => {
        const value = event.target.value;

        if (!value || value === "latest") {
          state.selectedSnapshot = null;
        } else {
          const entries = getHistoryEntries();

          state.selectedSnapshot = entries.find(item => {
            return String(historyEntryDate(item)) ===
              String(value);
          }) || null;
        }

        renderAll();
      });
    });
  }

  function populateSnapshotSelector() {
    const selectors = [
      "snapshotSelector",
      "historySelector",
      "analysisSelector"
    ];

    const entries = getHistoryEntries()
      .filter(item => historyEntryDate(item))
      .sort((a, b) => {
        return new Date(historyEntryDate(b)) -
          new Date(historyEntryDate(a));
      });

    selectors.forEach(id => {
      const node = el(id);

      if (!node || node.tagName !== "SELECT") {
        return;
      }

      const existingValue = node.value;

      const options = [
        `<option value="latest">Latest snapshot</option>`,
        ...entries.map(item => {
          const date = historyEntryDate(item);

          return `
            <option value="${escapeHtml(date)}">
              ${escapeHtml(formatTimestamp(date))}
            </option>
          `;
        })
      ];

      node.innerHTML = options.join("");

      if (
        existingValue &&
        Array.from(node.options).some(
          option => option.value === existingValue
        )
      ) {
        node.value = existingValue;
      } else {
        node.value = "latest";
      }
    });
  }

  /* ============================================================
     REFRESH BUTTON
     ============================================================ */

  function bindRefreshButton() {
    const buttons = [
      "refreshButton",
      "refreshBtn",
      "reloadButton"
    ];

    buttons.forEach(id => {
      const button = el(id);

      if (!button || button.dataset.bound === "true") {
        return;
      }

      button.dataset.bound = "true";

      button.addEventListener("click", async () => {
        await loadDashboard(true);
      });
    });
  }

  /* ============================================================
     RESPONSIVE CHART RESIZING
     ============================================================ */

  function resizeCharts() {
    const chartPairs = [
      [state.priceChart, [
        "priceChart",
        "candlestickChart",
        "mainChart",
        "chartContainer"
      ]],
      [state.volumeChart, [
        "volumeChart",
        "volumeChartContainer"
      ]],
      [state.rsiChart, [
        "rsiChart",
        "rsiChartContainer"
      ]]
    ];

    chartPairs.forEach(([chart, ids]) => {
      if (!chart) return;

      const container = findContainer(ids);

      if (!container) return;

      const width = container.clientWidth;

      if (width > 0) {
        chart.applyOptions({
          width
        });
      }
    });
  }

  function setupResizeHandling() {
    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
    }

    if ("ResizeObserver" in window) {
      state.resizeObserver = new ResizeObserver(() => {
        resizeCharts();
      });

      const containers = [
        "priceChart",
        "candlestickChart",
        "mainChart",
        "chartContainer",
        "volumeChart",
        "volumeChartContainer",
        "rsiChart",
        "rsiChartContainer"
      ];

      const observed = new Set();

      containers.forEach(id => {
        const node = el(id);

        if (node && !observed.has(node)) {
          observed.add(node);
          state.resizeObserver.observe(node);
        }
      });
    } else {
      window.addEventListener(
        "resize",
        resizeCharts,
        { passive: true }
      );
    }
  }

  /* ============================================================
     LOAD LATEST AND HISTORICAL DATA
     ============================================================ */

  async function loadDashboardData() {
    const latest = await fetchJSON(CONFIG.latestUrl);

    state.latest = latest;

    try {
      const history = await fetchJSON(CONFIG.historyUrl);

      state.history = Array.isArray(history)
        ? history
        : first(
            history.history,
            history.snapshots,
            history.items,
            history.data,
            history
          );
    } catch (error) {
      console.warn(
        "Historical data could not be loaded:",
        error
      );

      state.history = [];
    }

    if (!Array.isArray(state.history)) {
      state.history = state.history &&
        typeof state.history === "object"
          ? Object.values(state.history)
          : [];
    }

    state.history = state.history.filter(
      item => item && typeof item === "object"
    );
  }

  /* ============================================================
     RENDER ALL DASHBOARD SECTIONS
     ============================================================ */

  function renderAll() {
    const data = getCurrentData();

    if (!data || typeof data !== "object") {
      updateStatus(
        "No market data available.",
        "error"
      );

      return;
    }

    renderHeader(data);
    renderOverall(data);
    renderSnapshot(data);

    renderPriceAction();
    renderTrendAnalysis();

    renderOptions();
    renderGlobalMarkets();
    renderWeeklyTrend();
    renderScoreBreakdown();
    renderNews();

    bindSelectors();
    bindSnapshotSelector();
    bindRefreshButton();

    populateSnapshotSelector();

    setupResizeHandling();

    requestAnimationFrame(() => {
      resizeCharts();
    });
  }

  /* ============================================================
     DASHBOARD INITIALIZATION
     ============================================================ */

  async function loadDashboard(isManualRefresh = false) {
    if (state.loading) return;

    state.loading = true;

    if (isManualRefresh) {
      updateStatus(
        "Refreshing market data...",
        "loading"
      );
    }

    try {
      await loadDashboardData();

      renderAll();

      const updated = formatTimestamp(
        timestamp(state.latest)
      );

      updateStatus(
        `Data loaded successfully · ${updated}`,
        "success"
      );

    } catch (error) {
      console.error(
        "Dashboard loading failed:",
        error
      );

      updateStatus(
        "Unable to load market data. Please refresh.",
        "error"
      );

      const containers = [
        "indexCards",
        "technicalCards",
        "trendCards",
        "optionsCards",
        "optionsGrid",
        "globalCards",
        "weeklyCards",
        "scoreBreakdown",
        "newsCards"
      ];

      containers.forEach(id => {
        const node = el(id);

        if (node && !node.innerHTML.trim()) {
          node.innerHTML = `
            <div class="loading-card">
              Data could not be loaded.
              Check the browser console for details.
            </div>
          `;
        }
      });

    } finally {
      state.loading = false;
    }
  }

  /* ============================================================
     OPTIONAL AUTO-REFRESH
     ============================================================ */

  function startAutoRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
    }

    state.refreshTimer = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadDashboard(false);
      }
    }, CONFIG.refreshInterval);
  }

  /* ============================================================
     START THE DASHBOARD
     ============================================================ */

  function initializeDashboard() {
    bindSelectors();
    bindSnapshotSelector();
    bindRefreshButton();

    loadDashboard(false);

    startAutoRefresh();

    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible") {
          resizeCharts();
        }
      }
    );

    console.info(
      "Market Pulse Dashboard initialized."
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeDashboard,
      { once: true }
    );
  } else {
    initializeDashboard();
  }

})();