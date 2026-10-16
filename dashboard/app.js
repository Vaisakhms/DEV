/* Market Pulse Dashboard */
(() => {
  "use strict";

  const DATA_URL = "./data/latest.json";
  const HISTORY_URL = "./data/history/index.json";
  const REFRESH_MS = 60000;

  const $ = id => document.getElementById(id);

  const INDEX_NAMES = [
    "Nifty 50",
    "Bank Nifty",
    "Nifty Midcap"
  ];

  const state = {
    data: null,
    history: [],
    selectedIndex: "Nifty 50",
    timeframe: "Daily",
    charts: {},
    refreshing: false
  };

  const num = value => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const fmt = (value, decimals = 2) => {
    const n = num(value);

    return n === null
      ? "—"
      : n.toLocaleString("en-IN", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        });
  };

  const compact = value => {
    const n = num(value);

    return n === null
      ? "—"
      : Intl.NumberFormat("en-IN", {
          notation: "compact",
          maximumFractionDigits: 2
        }).format(n);
  };

  const pct = value => {
    const n = num(value);

    return n === null
      ? "—"
      : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
  };

  const tone = value => {
    const n = num(value);

    return n === null || n === 0
      ? "neutral"
      : n > 0 ? "positive" : "negative";
  };

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

  const setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value ?? "—";
  };

  const setHTML = (id, value) => {
    const el = $(id);
    if (el) el.innerHTML = value;
  };

  const arr = value => {
    if (Array.isArray(value)) return value;

    return value && typeof value === "object"
      ? Object.values(value)
      : [];
  };

  const getIndex = (name, data = state.data) =>
    data?.indices?.[name] || {};

  const getFrame = (
    index,
    timeframe = state.timeframe
  ) =>
    index?.timeframes?.[timeframe]
    || index?.timeframes?.Daily
    || {};

  const labelClass = label => {
    const text = String(label || "").toLowerCase();

    if (text.includes("bull")) return "positive";
    if (text.includes("bear")) return "negative";

    return "neutral";
  };

  async function fetchJSON(url) {
    const separator = url.includes("?") ? "&" : "?";

    const response = await fetch(
      `${url}${separator}_=${Date.now()}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }

    return response.json();
  }

  function notify(message) {
    const el = $("toast");

    if (!el) {
      console.log(message);
      return;
    }

    el.textContent = message;
    el.classList.add("show");

    setTimeout(() => {
      el.classList.remove("show");
    }, 3500);
  }

  function dateLabel(value) {
    if (!value) return "—";

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

  function renderHeader(data) {
    setText(
      "marketStatus",
      data.market_status || "Market status unavailable"
    );

    setText(
      "lastUpdated",
      dateLabel(data.generated_at_ist || data.generated_at)
    );

    setText(
      "dataTimestamp",
      data.generated_at_ist || data.generated_at || "—"
    );

    setText("sessionSummary", data.market_status || "—");
    setText("dataStatus", "Data loaded");
  }

  function renderOverall(data) {
    const overall = data.overall || {};
    const score = num(overall.score);
    const coverage = num(overall.coverage_pct);

    setText("overallScore", fmt(score, 1));
    setText("overallLabel", overall.label || "Market Bias");
    setText("scoreGaugeValue", fmt(score, 1));

    setText(
      "scoreNote",
      score === null
        ? "Overall score unavailable."
        : `Model score: ${fmt(score, 1)} / 100`
    );

    const bounded = score === null
      ? 0
      : Math.max(0, Math.min(100, score));

    if ($("scoreTrackFill")) {
      $("scoreTrackFill").style.width = `${bounded}%`;
    }

    if ($("scoreGauge")) {
      $("scoreGauge").style.setProperty(
        "--score",
        `${bounded * 3.6}deg`
      );
    }

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
      const index = getIndex(name, data);
      const frame = index.timeframes?.Daily || {};
      const label = frame.label || "Market";

      return `
        <article class="panel index-card">
          <div class="index-card-top">
            <span class="eyebrow">${esc(name)}</span>
            <span class="badge ${labelClass(label)}">
              ${esc(label)}
            </span>
          </div>

          <div class="index-price">${fmt(frame.close)}</div>

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

  function rsiGuidance(value) {
    const rsi = num(value);

    if (rsi === null) {
      return {
        label: "Unavailable",
        detail: "RSI data is unavailable."
      };
    }

    if (rsi >= 70) {
      return {
        label: "Overbought",
        detail: "Strong momentum, but pullback risk is elevated. Avoid chasing price; look for confirmation before acting."
      };
    }

    if (rsi <= 30) {
      return {
        label: "Oversold",
        detail: "Selling pressure has been strong. A rebound is possible, but wait for price confirmation rather than assuming a reversal."
      };
    }

    if (rsi >= 55) {
      return {
        label: "Bullish momentum",
        detail: "Momentum favours buyers. Check price structure and moving averages for confirmation."
      };
    }

    if (rsi >= 45) {
      return {
        label: "Neutral momentum",
        detail: "Momentum is mixed. Wait for a clearer directional move."
      };
    }

    return {
      label: "Bearish momentum",
      detail: "Momentum favours sellers. Watch for price stabilisation before considering a reversal."
    };
  }

  function renderTechnical(data) {
    const cards = [];

    INDEX_NAMES.forEach(name => {
      const index = getIndex(name, data);

      ["15m", "30m", "1h", "Daily"].forEach(tf => {
        const frame = index.timeframes?.[tf];

        if (!frame) return;

        const rsi = rsiGuidance(frame.rsi);

        cards.push(`
          <article class="panel technical-card">
            <div class="technical-card-head">
              <strong>${esc(name)}</strong>
              <span class="badge ${labelClass(frame.label)}">
                ${esc(tf)} · ${esc(frame.label || "Trend")}
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

            <div class="rsi-guidance">
              <strong>RSI interpretation: ${esc(rsi.label)}</strong>
              <p>${esc(rsi.detail)}</p>
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

  /* PART 2 GOES BELOW */
  function renderOptions(data) {
    const options = data.options || {};

    setText("pcrValue", fmt(options.pcr));
    setText("nearAtmPcr", fmt(options.zone_pcr));
    setText("atmStrike", fmt(options.atm, 0));
    setText("supportValue", fmt(options.support, 0));
    setText("resistanceValue", fmt(options.resistance, 0));

    let pcrText = "Options data unavailable";

    if (num(options.pcr) !== null) {
      pcrText = options.pcr > 1.2
        ? "PCR is elevated: put OI is relatively higher."
        : options.pcr < 0.8
          ? "PCR is low: call OI is relatively higher."
          : "PCR is in a broadly balanced range.";
    }

    setText("pcrLabel", pcrText);

    setText(
      "optionsSource",
      `Source: ${options.source || "—"} | Expiry: ${options.expiry || "—"}`
    );

    const contracts = [
      {
        title: "ATM Call (CE)",
        data: options.ce || {},
        className: "positive"
      },
      {
        title: "ATM Put (PE)",
        data: options.pe || {},
        className: "negative"
      }
    ];

    const html = contracts.map(contract => {
      const item = contract.data;

      return `
        <article class="panel option-card">
          <div class="option-card-head">
            <strong>${contract.title}</strong>
            <span class="badge ${contract.className}">
              ${esc(item.buildup || "—")}
            </span>
          </div>

          <div class="technical-metrics">
            <div>
              <small>LTP</small>
              <strong>${fmt(item.ltp)}</strong>
            </div>
            <div>
              <small>LTP change</small>
              <strong class="${tone(item.ltpch)}">
                ${fmt(item.ltpch)}
              </strong>
            </div>
            <div>
              <small>Open interest</small>
              <strong>${compact(item.oi)}</strong>
            </div>
            <div>
              <small>OI change</small>
              <strong class="${tone(item.oich)}">
                ${compact(item.oich)}
              </strong>
            </div>
          </div>
        </article>
      `;
    }).join("");

    setHTML(
      "optionsCards",
      html || '<div class="loading-card">Options data unavailable.</div>'
    );
  }

  function renderGlobal(data) {
    const markets = arr(data.global_markets);

    const html = markets.map(market => `
      <article class="panel global-card">
        <div class="global-card-head">
          <strong>${esc(market.name || market.ticker || "Market")}</strong>
        </div>

        <div class="global-price">${fmt(market.price)}</div>

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
      const weekly = getIndex(name, data).seven_day || {};
      const changes = arr(weekly.chg);

      const bars = changes.map(change => {
        const height = Math.max(
          6,
          Math.min(48, Math.abs(num(change) || 0) * 14)
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
            <span class="${tone(weekly.net)}">${pct(weekly.net)}</span>
          </div>

          <div class="weekly-bars">${bars}</div>

          <div class="weekly-stats">
            <span>Positive sessions: <strong>${fmt(weekly.up, 0)}/7</strong></span>
            <span>High: <strong>${fmt(weekly.hi)}</strong></span>
            <span>Low: <strong>${fmt(weekly.lo)}</strong></span>
          </div>
        </article>
      `;
    }).join("");

    setHTML("weeklyCards", html);
  }

  function renderBreakdown(data) {
    const components = arr(data.scores?.components);

    const html = components.map(component => `
      <div class="breakdown-row">
        <span>
          ${esc(component.name || "Factor")}
          <small>
            Weight: ${fmt(component.weight, 0)}
            | Score: ${fmt(component.score)}
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
    const items = arr(news.items);

    setHTML(
      "newsSummary",
      `<div class="sentiment-chip">
        <span>News sentiment score</span>
        <strong class="${tone(news.score)}">${fmt(news.score)}</strong>
      </div>`
    );

    const html = items.slice(0, 20).map(item => `
      <article class="panel news-card">
        <div class="news-card-head">
          <span class="eyebrow">${esc(item.source || "Market news")}</span>
          <span class="news-age">
            ${num(item.age) === null ? "" : `${fmt(item.age, 1)}h ago`}
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
        background: { color: "transparent" },
        textColor: "#94a3b8"
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,.10)" },
        horzLines: { color: "rgba(148,163,184,.10)" }
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false
      }
    };
  }

  function clearCharts() {
    Object.values(state.charts).forEach(chart => {
      try {
        chart.remove();
      } catch (_) {}
    });

    state.charts = {};
  }

  function renderCharts(data = state.data) {
    if (!data) return;

    const index = getIndex(state.selectedIndex, data);
    const frame = getFrame(index, state.timeframe);

    setText("chartInstrument", state.selectedIndex);
    setText("chartPrice", fmt(frame.close));
    setText("chartChange", pct(frame.chg));

    const candles = arr(
      index.charts?.[state.timeframe]
    ).filter(candle =>
      num(candle.time) !== null &&
      ["open", "high", "low", "close"].every(
        key => num(candle[key]) !== null
      )
    ).sort((a, b) => Number(a.time) - Number(b.time));

    setText("candleCount", `${candles.length} candles`);

    const priceEl = $("priceChart");
    const volumeEl = $("volumeChart");
    const rsiEl = $("rsiChart");

    if (!priceEl || !volumeEl || !rsiEl) return;

    clearCharts();

    if (!window.LightweightCharts || !candles.length) {
      setHTML(
        "priceChart",
        '<div class="chart-placeholder">No candles available for this timeframe.</div>'
      );
      setHTML(
        "volumeChart",
        '<div class="chart-placeholder">Volume data unavailable.</div>'
      );
      setHTML(
        "rsiChart",
        '<div class="chart-placeholder">RSI chart data unavailable.</div>'
      );
      return;
    }

    priceEl.innerHTML = "";
    volumeEl.innerHTML = "";
    rsiEl.innerHTML = "";

    const L = window.LightweightCharts;

    const priceChart = L.createChart(
      priceEl,
      chartOptions(priceEl, 320)
    );

    const candleSeries = priceChart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444"
    });

    candleSeries.setData(candles.map(candle => ({
      time: Number(candle.time),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close)
    })));

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

      series.setData(candles
        .filter(candle => num(candle[key]) !== null)
        .map(candle => ({
          time: Number(candle.time),
          value: Number(candle[key])
        }))
      );
    });

    priceChart.timeScale().fitContent();

    const volumeChart = L.createChart(
      volumeEl,
      chartOptions(volumeEl, 100)
    );

    const volumeSeries = volumeChart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: ""
    });

    volumeSeries.setData(candles.map(candle => ({
      time: Number(candle.time),
      value: Number(candle.volume) || 0,
      color: Number(candle.close) >= Number(candle.open)
        ? "rgba(34,197,94,.55)"
        : "rgba(239,68,68,.55)"
    })));

    volumeChart.timeScale().fitContent();

    const rsiChart = L.createChart(
      rsiEl,
      chartOptions(rsiEl, 110)
    );

    const rsiSeries = rsiChart.addLineSeries({
      color: "#a78bfa",
      lineWidth: 2,
      priceLineVisible: false
    });

    rsiSeries.setData(candles
      .filter(candle => num(candle.rsi) !== null)
      .map(candle => ({
        time: Number(candle.time),
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

  /* PART 3 GOES BELOW */
  function renderHistory() {
    const html = state.history.map(item => `
      <button
        type="button"
        class="history-item"
        data-history-file="${esc(item.file)}">

        <span>
          <strong>
            ${esc(item.generated_at_ist || item.generated_at || item.file)}
          </strong>
          <small>
            ${esc(item.label || "Historical analysis")}
            | Nifty ${fmt(item.nifty_close, 0)}
          </small>
        </span>

        <strong>${fmt(item.score, 1)}</strong>
      </button>
    `).join("");

    setHTML(
      "historyList",
      html || '<div class="loading-card">No historical snapshots available.</div>'
    );

    document.querySelectorAll("[data-history-file]").forEach(button => {
      button.addEventListener("click", async () => {
        const file = button.dataset.historyFile;

        try {
          const snapshot = await fetchJSON(
            `./data/history/${encodeURIComponent(file)}`
          );

          renderAll(snapshot);
          notify(`Viewing historical snapshot: ${file}`);
        } catch (error) {
          console.error("History loading failed:", error);
          notify("Unable to load this historical snapshot.");
        }
      });
    });
  }

  function renderAll(data) {
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

    if (button) button.disabled = true;

    try {
      const data = await fetchJSON(DATA_URL);

      renderAll(data);

      try {
        const history = await fetchJSON(HISTORY_URL);

        state.history = Array.isArray(history) ? history : [];
        renderHistory();
      } catch (error) {
        console.warn("History index unavailable:", error);
        state.history = [];
        renderHistory();
      }

      setText("dataStatus", "Data loaded");
    } catch (error) {
      console.error("Dashboard error:", error);

      setText("dataStatus", "Load error");

      notify(`Dashboard failed to load: ${error.message}`);
    } finally {
      state.refreshing = false;

      if (button) button.disabled = false;
    }
  }

  function bindControls() {
    const indexSelect = $("indexSelect");

    if (indexSelect) {
      indexSelect.addEventListener("change", () => {
        state.selectedIndex = INDEX_NAMES.includes(indexSelect.value)
          ? indexSelect.value
          : "Nifty 50";

        renderCharts();
      });
    }

    document.querySelectorAll("[data-timeframe]").forEach(button => {
      button.addEventListener("click", () => {
        state.timeframe = button.dataset.timeframe;

        document.querySelectorAll("[data-timeframe]").forEach(item => {
          item.classList.toggle("active", item === button);
        });

        renderCharts();
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
      const entries = [
        ["price", "priceChart"],
        ["volume", "volumeChart"],
        ["rsi", "rsiChart"]
      ];

      entries.forEach(([key, id]) => {
        const chart = state.charts[key];
        const element = $(id);

        if (chart && element) {
          chart.applyOptions({
            width: Math.max(280, element.clientWidth || 320)
          });
        }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindControls();
    refreshDashboard();

    window.setInterval(
      refreshDashboard,
      REFRESH_MS
    );
  });
})();