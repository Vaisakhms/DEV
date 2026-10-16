/* ============================================================
   MARKET ANALYSIS DASHBOARD
   File: dashboard/app.js
   Data files:
     data/latest.json
     data/history/index.json
   Dependency:
   Load Lightweight Charts v4.2.2 before this script in index.html.
   ============================================================ */
(() => {
  "use strict";
  const CONFIG = {
    latestUrl: "data/latest.json",
    historyIndexUrl: "data/history/index.json",
    refreshInterval: 60000,
    requestTimeout: 15000,
    defaultIndex: "Nifty 50",
    defaultTimeframe: "15m",
    colors: {
      bullish: "#22c55e",
      bearish: "#ef4444",
      sma20: "#f59e0b",
      sma50: "#38bdf8",
      sma100: "#c084fc",
      rsi: "#a78bfa",
      grid: "rgba(148,163,184,0.12)",
      text: "#94a3b8"
    }
  };
  const state = {
    latest: null,
    history: [],
    selectedIndex: CONFIG.defaultIndex,
    selectedTimeframe: CONFIG.defaultTimeframe,
    selectedSnapshot: null,
    priceChart: null,
    candleSeries: null,
    sma20Series: null,
    sma50Series: null,
    sma100Series: null,
    volumeSeries: null,
    rsiChart: null,
    rsiSeries: null,
    refreshTimer: null,
    resizeObserver: null,
    loading: false
  };
  const $ = (selector, root = document) =>
    root.querySelector(selector);
  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));
  const first = (...values) =>
    values.find(value =>
      value !== undefined &&
      value !== null &&
      value !== ""
    );
  function getElement(...ids) {
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) return element;
    }
    return null;
  }
  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function formatNumber(value, decimals = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "—";
    }
    return number.toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }
  function compactNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "—";
    }
    return Intl.NumberFormat("en-IN", {
      notation: "compact",
      maximumFractionDigits: 2
    }).format(number);
  }
  function signedNumber(value, decimals = 2, suffix = "") {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "—";
    }
    const sign = number > 0 ? "+" : "";
    return `${sign}${formatNumber(number, decimals)}${suffix}`;
  }
  function toArray(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && typeof value === "object") {
      return Object.values(value);
    }
    return [];
  }
  function setText(target, value) {
    const element =
      typeof target === "string"
        ? getElement(target)
        : target;
    if (!element) return;
    element.textContent =
      value === undefined || value === null || value === ""
        ? "—"
        : String(value);
  }
  function setHtml(target, html) {
    const element =
      typeof target === "string"
        ? getElement(target)
        : target;
    if (element) {
      element.innerHTML = html;
    }
  }
  function setStatus(message, type = "info") {
    const statusElement = getElement(
      "connectionStatus",
      "statusMessage",
      "dataStatus"
    );
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.dataset.status = type;
      statusElement.classList.toggle(
        "is-error",
        type === "error"
      );
      statusElement.classList.toggle(
        "is-success",
        type === "success"
      );
    }
    const dot = getElement("connectionDot", "statusDot");
    if (dot) {
      dot.classList.toggle("is-error", type === "error");
      dot.classList.toggle("is-success", type === "success");
    }
  }
  async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      CONFIG.requestTimeout
    );
    try {
      const separator = url.includes("?") ? "&" : "?";
      const response = await fetch(
        `${url}${separator}_=${Date.now()}`,
        {
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Accept: "application/json"
          }
        }
      );
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${url}`
        );
      }
      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }
  function getTimestamp(data) {
    return first(
      data?.generated_at_ist,
      data?.generatedAtIST,
      data?.generated_at,
      data?.updated_at,
      data?.timestamp,
      data?.as_of,
      data?.date
    );
  }
  function formatTimestamp(value) {
    if (!value) {
      return "Update time unavailable";
    }
    let date;
    if (typeof value === "number") {
      date = new Date(
        value < 1e12 ? value * 1000 : value
      );
    } else {
      date = new Date(value);
    }
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return (
      date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      }) + " IST"
    );
  }
  function getIndices(data) {
    const raw = first(
      data?.indices,
      data?.indexes,
      data?.market_indices,
      data?.markets,
      {}
    );
    if (Array.isArray(raw)) {
      const result = {};
      raw.forEach(item => {
        const name = first(
          item?.name,
          item?.index,
          item?.title,
          item?.symbol
        );
        if (name) {
          result[name] = item;
        }
      });
      return result;
    }
    return raw && typeof raw === "object"
      ? raw
      : {};
  }
  function getIndex(indexName, snapshot) {
    const data =
      snapshot ||
      state.selectedSnapshot ||
      state.latest ||
      {};
    const indices = getIndices(data);
    if (indices[indexName]) {
      return indices[indexName];
    }
    const aliases = {
      "Nifty 50": [
        "NIFTY 50",
        "Nifty50",
        "NIFTY",
        "NSE:NIFTY50-INDEX"
      ],
      "Bank Nifty": [
        "BANKNIFTY",
        "NIFTY BANK",
        "NSE:NIFTYBANK-INDEX"
      ],
      "Nifty Midcap": [
        "Nifty Midcap 50",
        "NIFTYMIDCAP50",
        "NIFTY MIDCAP 50",
        "NSE:NIFTYMIDCAP50-INDEX"
      ]
    };
    for (const alias of aliases[indexName] || []) {
      const matchingKey = Object.keys(indices).find(
        key => key.toLowerCase() === alias.toLowerCase()
      );
      if (matchingKey) {
        return indices[matchingKey];
      }
    }
    const found = Object.entries(indices).find(
      ([key, item]) => {
        const text = (
          `${key} ${item?.name || ""} ${item?.symbol || ""}`
        ).toLowerCase();
        if (indexName === "Nifty 50") {
          return (
            text.includes("nifty") &&
            !text.includes("bank") &&
            !text.includes("midcap")
          );
        }
        if (indexName === "Bank Nifty") {
          return (
            text.includes("bank") &&
            text.includes("nifty")
          );
        }
        if (indexName === "Nifty Midcap") {
          return text.includes("midcap");
        }
        return false;
      }
    );
    return found?.[1] || {};
  }
  function getTimeframes(indexObject) {
    const raw = first(
      indexObject?.timeframes,
      indexObject?.time_frames,
      indexObject?.intervals,
      indexObject?.frames,
      indexObject?.data,
      {}
    );
    return raw && typeof raw === "object"
      ? raw
      : {};
  }
  function getFrame(
    indexName,
    timeframe,
    snapshot
  ) {
    const indexObject = getIndex(
      indexName,
      snapshot
    );
    const frames = getTimeframes(indexObject);
    const aliases = {
      "15m": [
        "15m",
        "15min",
        "15_min",
        "15 minutes",
        "15"
      ],
      "30m": [
        "30m",
        "30min",
        "30_min",
        "30 minutes",
        "30"
      ],
      "1h": [
        "1h",
        "60m",
        "60min",
        "1hour",
        "1 hour",
        "60"
      ],
      "Daily": [
        "Daily",
        "daily",
        "1d",
        "D",
        "day"
      ]
    };
    for (const alias of aliases[timeframe] || [timeframe]) {
      const key = Object.keys(frames).find(
        item => item.toLowerCase() === alias.toLowerCase()
      );
      if (key) {
        return frames[key] || {};
      }
    }
    return {};
  }
  function getCandles(frame) {
    const rawCandles = toArray(
      first(
        frame?.candles,
        frame?.ohlc,
        frame?.history,
        frame?.chart_data,
        frame?.chartData,
        frame?.bars,
        frame?.data_points,
        frame?.prices,
        []
      )
    );
    return rawCandles
      .map(candle => {
        let time = first(
          candle?.time,
          candle?.timestamp,
          candle?.date,
          candle?.datetime,
          candle?.t
        );
        if (typeof time === "string") {
          const parsed = Date.parse(time);
          if (Number.isFinite(parsed)) {
            time = Math.floor(parsed / 1000);
          }
        } else if (
          typeof time === "number" &&
          time > 1e12
        ) {
          time = Math.floor(time / 1000);
        }
        const open = Number(
          first(candle?.open, candle?.o)
        );
        const high = Number(
          first(candle?.high, candle?.h)
        );
        const low = Number(
          first(candle?.low, candle?.l)
        );
        const close = Number(
          first(candle?.close, candle?.c)
        );
        const volume = Number(
          first(
            candle?.volume,
            candle?.vol,
            candle?.v,
            0
          )
        );
        if (
          time == null ||
          ![open, high, low, close].every(Number.isFinite)
        ) {
          return null;
        }
        return {
          time,
          open,
          high,
          low,
          close,
          volume: Number.isFinite(volume) ? volume : 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0)
      .filter(
        (candle, index, list) =>
          index === 0 ||
          candle.time !== list[index - 1].time
      );
  }
  function calculateSMA(candles, index, period) {
    if (index + 1 < period) {
      return null;
    }
    let total = 0;
    for (
      let i = index - period + 1;
      i <= index;
      i++
    ) {
      total += candles[i].close;
    }
    return total / period;
  }
  function getSMAPoints(
    frame,
    candles,
    key,
    aliases,
    period
  ) {
    const raw = first(
      frame?.[key],
      ...aliases.map(alias => frame?.[alias])
    );
    if (Array.isArray(raw)) {
      return raw
        .map((point, index) => {
          if (typeof point === "number") {
            return {
              time: candles[index]?.time,
              value: point
            };
          }
          let time = first(
            point?.time,
            point?.timestamp,
            point?.date,
            candles[index]?.time
          );
          if (typeof time === "string") {
            const parsed = Date.parse(time);
            if (Number.isFinite(parsed)) {
              time = Math.floor(parsed / 1000);
            }
          } else if (
            typeof time === "number" &&
            time > 1e12
          ) {
            time = Math.floor(time / 1000);
          }
          return {
            time,
            value: Number(
              first(
                point?.value,
                point?.close,
                point?.[key]
              )
            )
          };
        })
        .filter(
          point =>
            point.time != null &&
            Number.isFinite(point.value)
        );
    }
    return candles
      .map((candle, index) => {
        const value = calculateSMA(
          candles,
          index,
          period
        );
        return value == null
          ? null
          : {
              time: candle.time,
              value
            };
      })
      .filter(Boolean);
  }
    function getChange(frame) {
    return first(
      frame?.change_percent,
      frame?.changePercent,
      frame?.chg_pct,
      frame?.chg,
      frame?.change,
      frame?.percent_change
    );
  }
  function getLastClose(frame, candles) {
    return first(
      frame?.close,
      frame?.ltp,
      frame?.last_price,
      frame?.lastPrice,
      frame?.price,
      candles.at(-1)?.close
    );
  }
  function getSentiment(value) {
    const text = String(value ?? "").toLowerCase();
    if (
      text.includes("bull") ||
      text.includes("positive") ||
      text.includes("buy")
    ) {
      return "bullish";
    }
    if (
      text.includes("bear") ||
      text.includes("negative") ||
      text.includes("sell")
    ) {
      return "bearish";
    }
    return "neutral";
  }
  function createBadge(label, sentiment = null) {
    const text = label || "Neutral";
    const className = sentiment || getSentiment(text);
    return `
      <span class="badge ${escapeHtml(className)}">
        ${escapeHtml(text)}
      </span>
    `;
  }
  /* ============================================================
     HEADER AND OVERALL MARKET BIAS
     ============================================================ */
  function renderHeader(data) {
    const generatedAt = getTimestamp(data);
    setText("lastUpdated", formatTimestamp(generatedAt));
    setText("updatedAt", formatTimestamp(generatedAt));
    setText("marketDate", formatTimestamp(generatedAt));
    setText(
      "marketStatus",
      first(
        data?.market_status,
        data?.marketStatus,
        data?.session_status,
        "Market status unavailable"
      )
    );
    const score = first(
      data?.score,
      data?.overall_score,
      data?.overallScore,
      data?.market_score
    );
    const label = first(
      data?.label,
      data?.overall_label,
      data?.overallLabel,
      data?.bias,
      data?.market_bias,
      "Neutral"
    );
    setText(
      "overallScore",
      score == null ? "—" : signedNumber(score, 0)
    );
    setText("overallLabel", label);
    setText("marketBias", label);
    const scoreElement = getElement(
      "overallScore",
      "marketScore"
    );
    if (scoreElement) {
      scoreElement.classList.remove(
        "bullish",
        "bearish",
        "neutral"
      );
      scoreElement.classList.add(
        getSentiment(label)
      );
    }
    const coverage = first(
      data?.coverage,
      data?.coverage_percent,
      data?.coveragePercent
    );
    setText(
      "coverage",
      coverage == null
        ? "—"
        : `${formatNumber(coverage, 0)}%`
    );
    const summary = first(
      data?.market_summary,
      data?.summary,
      data?.overall_summary,
      data?.commentary
    );
    if (summary) {
      setText("marketSummary", summary);
    }
  }
  /* ============================================================
     INDEX CARDS
     ============================================================ */
  function renderIndexCards(data) {
    const indices = getIndices(data);
    const targets = [
      {
        title: "Nifty 50",
        matches: ["nifty 50", "nifty50", "nse:nifty50-index"]
      },
      {
        title: "Bank Nifty",
        matches: [
          "bank nifty",
          "nifty bank",
          "niftybank",
          "nse:niftybank-index"
        ]
      },
      {
        title: "Nifty Midcap",
        matches: ["midcap", "nifty midcap"]
      }
    ];
    const cards = [];
    targets.forEach(target => {
      const entry = Object.entries(indices).find(
        ([key, item]) => {
          const text = (
            `${key} ${item?.name || ""} ${item?.symbol || ""}`
          ).toLowerCase();
          return target.matches.some(
            match => text.includes(match)
          );
        }
      );
      if (!entry) return;
      const [indexName, indexData] = entry;
      const frame = getFrame(
        indexName,
        state.selectedTimeframe,
        data
      );
      const candles = getCandles(frame);
      const price = first(
        getLastClose(frame, candles),
        indexData?.ltp,
        indexData?.price,
        indexData?.close
      );
      const changeValue =
        getChange(frame) ?? getChange(indexData);
      const label = first(
        frame?.label,
        frame?.bias,
        frame?.trend,
        indexData?.label,
        indexData?.bias,
        "Neutral"
      );
      const changeClass =
        Number(changeValue) > 0
          ? "bullish"
          : Number(changeValue) < 0
            ? "bearish"
            : "neutral";
      const rsi = first(
        frame?.rsi,
        frame?.RSI
      );
      const score = first(
        frame?.score,
        frame?.weighted_score,
        frame?.weightedScore
      );
      cards.push(`
        <article class="index-card">
          <div class="index-card-top">
            <span class="index-name">
              ${escapeHtml(target.title)}
            </span>
            ${createBadge(label)}
          </div>
          <div class="index-price">
            ${price == null ? "—" : formatNumber(price)}
          </div>
          <div class="index-change ${changeClass}">
            ${changeValue == null
              ? "—"
              : signedNumber(changeValue, 2, "%")}
          </div>
          <div class="index-card-bottom">
            <span>
              RSI <b>${formatNumber(rsi, 1)}</b>
            </span>
            <span>
              Score <b>${escapeHtml(score ?? "—")}</b>
            </span>
          </div>
        </article>
      `);
    });
    const container = getElement(
      "indexCards",
      "indicesGrid",
      "marketCards",
      "indexOverview"
    );
    if (!container) return;
    setHtml(
      container,
      cards.length
        ? cards.join("")
        : `
          <div class="empty-state">
            Index data is not available in this snapshot.
          </div>
        `
    );
  }
  /* ============================================================
     SCORE BREAKDOWN
     ============================================================ */
  function renderScoreBreakdown(data) {
    const rows = toArray(
      first(
        data?.score_breakdown,
        data?.scoreBreakdown,
        data?.components,
        data?.signals,
        data?.weighted_factors,
        []
      )
    );
    const container = getElement(
      "scoreBreakdown",
      "scoreComponents",
      "factorBreakdown"
    );
    if (!container) return;
    if (!rows.length) {
      setHtml(
        container,
        '<div class="empty-state">No score breakdown available.</div>'
      );
      return;
    }
    setHtml(
      container,
      rows.map(item => {
        const name = first(
          item?.name,
          item?.factor,
          item?.component,
          item?.title,
          "Factor"
        );
        const score = first(
          item?.score,
          item?.value,
          item?.weighted_score,
          item?.points
        );
        const label = first(
          item?.label,
          item?.signal,
          item?.bias,
          item?.status,
          "Neutral"
        );
        const detail = first(
          item?.detail,
          item?.description,
          item?.reason,
          item?.comment,
          ""
        );
        const numericScore = Number(score);
        const width = Number.isFinite(numericScore)
          ? Math.min(100, Math.abs(numericScore))
          : 0;
        return `
          <div class="score-row">
            <div class="score-row-head">
              <span>${escapeHtml(name)}</span>
              <span>
                ${score == null
                  ? "—"
                  : escapeHtml(signedNumber(score, 1))}
              </span>
            </div>
            <div class="score-track">
              <span
                class="score-fill ${getSentiment(score)}"
                style="width:${width}%"
              ></span>
            </div>
            <div class="score-row-foot">
              ${createBadge(label)}
              ${detail
                ? `<span class="muted">${escapeHtml(detail)}</span>`
                : ""}
            </div>
          </div>
        `;
      }).join("")
    );
  }
  /* ============================================================
     OPTIONS / PUT-CALL RATIO / OPEN INTEREST
     ============================================================ */
  function renderOptions(data) {
    const options = first(
      data?.options,
      data?.option_chain,
      data?.optionChain,
      data?.oi_analysis,
      data?.oiAnalysis,
      {}
    );
    const container = getElement(
      "optionsPanel",
      "optionsData",
      "optionsContent"
    );
    if (!container) return;
    const pcr = first(
      options?.pcr,
      options?.overall_pcr,
      options?.overallPCR,
      options?.put_call_ratio
    );
    const atmPcr = first(
      options?.near_atm_pcr,
      options?.nearATMPcr,
      options?.atm_pcr,
      options?.atmPCR
    );
    const support = first(
      options?.support,
      options?.support_level,
      options?.supportLevel,
      options?.max_pain
    );
    const resistance = first(
      options?.resistance,
      options?.resistance_level,
      options?.resistanceLevel
    );
    const callOi = first(
      options?.call_oi,
      options?.callOI,
      options?.ce_oi,
      options?.total_ce_oi,
      options?.ce?.oi
    );
    const putOi = first(
      options?.put_oi,
      options?.putOI,
      options?.pe_oi,
      options?.total_pe_oi,
      options?.pe?.oi
    );
    const bias = first(
      options?.bias,
      options?.sentiment,
      options?.label,
      options?.interpretation
    );
    setHtml(
      container,
      `
        <div class="metric-grid">
          <div class="metric">
            <span>PCR</span>
            <strong>${pcr == null ? "—" : formatNumber(pcr)}</strong>
          </div>
          <div class="metric">
            <span>Near-ATM PCR</span>
            <strong>${atmPcr == null ? "—" : formatNumber(atmPcr)}</strong>
          </div>
          <div class="metric">
            <span>Support</span>
            <strong>${support == null ? "—" : formatNumber(support, 0)}</strong>
          </div>
          <div class="metric">
            <span>Resistance</span>
            <strong>${resistance == null ? "—" : formatNumber(resistance, 0)}</strong>
          </div>
          <div class="metric">
            <span>Call OI</span>
            <strong>${callOi == null ? "—" : compactNumber(callOi)}</strong>
          </div>
          <div class="metric">
            <span>Put OI</span>
            <strong>${putOi == null ? "—" : compactNumber(putOi)}</strong>
          </div>
        </div>
        ${bias
          ? `<div class="options-bias">
               Options bias: ${createBadge(bias)}
             </div>`
          : ""}
      `
    );
  }
  /* ============================================================
     GLOBAL MARKETS
     ============================================================ */
  function renderGlobalMarkets(data) {
    const rows = toArray(
      first(
        data?.global_markets,
        data?.globalMarkets,
        data?.global_indices,
        data?.globalIndices,
        data?.international_markets,
        data?.global,
        []
      )
    );
    const container = getElement(
      "globalMarkets",
      "globalMarketsList",
      "globalMarketData"
    );
    if (!container) return;
    if (!rows.length) {
      setHtml(
        container,
        '<div class="empty-state">Global market data is not available.</div>'
      );
      return;
    }
    setHtml(
      container,
      rows.map(item => {
        const name = first(
          item?.name,
          item?.index,
          item?.symbol,
          item?.title,
          "Market"
        );
        const price = first(
          item?.price,
          item?.close,
          item?.value,
          item?.last,
          item?.ltp
        );
        const changeValue = first(
          item?.change_percent,
          item?.changePercent,
          item?.chg_pct,
          item?.change,
          item?.pct_change,
          item?.percent
        );
        const changeClass =
          Number(changeValue) > 0
            ? "bullish"
            : Number(changeValue) < 0
              ? "bearish"
              : "neutral";
        return `
          <div class="market-row">
            <span class="market-row-name">
              ${escapeHtml(name)}
            </span>
            <span class="market-row-price">
              ${price == null ? "—" : formatNumber(price)}
            </span>
            <span class="market-row-change ${changeClass}">
              ${changeValue == null
                ? "—"
                : signedNumber(changeValue, 2, "%")}
            </span>
          </div>
        `;
      }).join("")
    );
  }
  /* ============================================================
     NEWS
     ============================================================ */
  function renderNews(data) {
    const rows = toArray(
      first(
        data?.news,
        data?.headlines,
        data?.sentiment_news,
        data?.sentimentNews,
        []
      )
    );
    const container = getElement(
      "newsList",
      "newsFeed",
      "newsContainer"
    );
    if (!container) return;
    if (!rows.length) {
      setHtml(
        container,
        '<div class="empty-state">No news headlines in this snapshot.</div>'
      );
      return;
    }
    setHtml(
      container,
      rows.slice(0, 30).map(item => {
        const title = first(
          item?.title,
          item?.headline,
          item?.text,
          "Untitled headline"
        );
        const source = first(
          item?.source,
          item?.publisher,
          item?.site,
          ""
        );
        const published = first(
          item?.published,
          item?.published_at,
          item?.publishedAt,
          item?.date,
          ""
        );
        const label = first(
          item?.sentiment,
          item?.label,
          item?.bias,
          ""
        );
        const url = first(
          item?.url,
          item?.link,
          item?.href,
          ""
        );
        const safeTitle = escapeHtml(title);
        const titleHtml =
          url && /^https?:\/\//i.test(String(url))
            ? `<a href="${escapeHtml(url)}"
                  target="_blank"
                  rel="noopener noreferrer">${safeTitle}</a>`
            : `<span>${safeTitle}</span>`;
        return `
          <article class="news-item">
            <div class="news-title">
              ${titleHtml}
            </div>
            <div class="news-meta">
              <span>${escapeHtml(source)}</span>
              <span>${escapeHtml(published)}</span>
              ${label ? createBadge(label) : ""}
            </div>
          </article>
        `;
      }).join("")
    );
  }
  /* ============================================================
     SEVEN-DAY SUMMARY
     ============================================================ */
  function renderSevenDay(data) {
    const summary = first(
      data?.seven_day,
      data?.sevenDay,
      data?.weekly_summary,
      data?.weeklySummary,
      data?.last_7_days,
      data?.history_summary
    );
    const container = getElement(
      "sevenDaySummary",
      "weeklySummary",
      "sevenDay"
    );
    if (!container) return;
    if (!summary) {
      setHtml(
        container,
        '<div class="empty-state">Seven-day summary is not available.</div>'
      );
      return;
    }
    if (Array.isArray(summary)) {
      setHtml(
        container,
        summary.map(item => `
          <div class="summary-row">
            <span>
              ${escapeHtml(first(item?.date, item?.day, item?.label, "—"))}
            </span>
            <span>
              ${escapeHtml(first(item?.bias, item?.label, item?.trend, "—"))}
            </span>
            <strong>
              ${escapeHtml(first(item?.score, item?.value, "—"))}
            </strong>
          </div>
        `).join("")
      );
      return;
    }
    if (typeof summary === "object") {
      const entries = Object.entries(summary);
      setHtml(
        container,
        entries.length
          ? entries.map(([key, value]) => {
              if (value && typeof value === "object") {
                return `
                  <div class="summary-row">
                    <span>${escapeHtml(first(value.date, value.day, key))}</span>
                    <span>${escapeHtml(first(value.bias, value.label, value.trend, "—"))}</span>
                    <strong>${escapeHtml(first(value.score, value.value, "—"))}</strong>
                  </div>
                `;
              }
              return `
                <div class="summary-row">
                  <span>${escapeHtml(key)}</span>
                  <strong>${escapeHtml(value)}</strong>
                </div>
              `;
            }).join("")
          : '<div class="empty-state">No seven-day summary available.</div>'
      );
      return;
    }
    setText(container, summary);
  }
  /* ============================================================
     CHART INITIALIZATION
     ============================================================ */
  function initializeCharts() {
    if (!window.LightweightCharts) {
      setStatus(
        "Chart library not found. Check index.html.",
        "error"
      );
      return;
    }
    const library = window.LightweightCharts;
    const priceElement = getElement(
      "priceChart",
      "mainChart",
      "candlestickChart",
      "chart"
    );
    const rsiElement = getElement(
      "rsiChart",
      "rsiGraph"
    );
    const layout = {
      background: { color: "transparent" },
      textColor: CONFIG.colors.text,
      fontFamily:
        "system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    };
    const grid = {
      vertLines: { color: CONFIG.colors.grid },
      horzLines: { color: CONFIG.colors.grid }
    };
    const commonOptions = {
      layout,
      grid,
      rightPriceScale: {
        borderColor: CONFIG.colors.grid
      },
      timeScale: {
        borderColor: CONFIG.colors.grid,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
        barSpacing: 7,
        minBarSpacing: 2
      },
      crosshair: {
        mode: library.CrosshairMode?.Normal ?? 0
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
      localization: {
        locale: "en-IN"
      }
    };
    if (priceElement && !state.priceChart) {
      state.priceChart = library.createChart(
        priceElement,
        {
          ...commonOptions,
          width: Math.max(
            280,
            priceElement.clientWidth || 320
          ),
          height: Math.max(
            260,
            Math.min(
              420,
              priceElement.clientHeight || 320
            )
          ),
          rightPriceScale: {
            borderColor: CONFIG.colors.grid,
            scaleMargins: {
              top: 0.08,
              bottom: 0.25
            }
          }
        }
      );
      state.candleSeries =
        state.priceChart.addCandlestickSeries({
          upColor: CONFIG.colors.bullish,
          downColor: CONFIG.colors.bearish,
          borderUpColor: CONFIG.colors.bullish,
          borderDownColor: CONFIG.colors.bearish,
          wickUpColor: CONFIG.colors.bullish,
          wickDownColor: CONFIG.colors.bearish,
          priceLineVisible: true,
          lastValueVisible: true
        });
      state.sma20Series =
        state.priceChart.addLineSeries({
          color: CONFIG.colors.sma20,
          lineWidth: 1,
          title: "SMA 20",
          priceLineVisible: false,
          lastValueVisible: false
        });
      state.sma50Series =
        state.priceChart.addLineSeries({
          color: CONFIG.colors.sma50,
          lineWidth: 1,
          title: "SMA 50",
          priceLineVisible: false,
          lastValueVisible: false
        });
      state.sma100Series =
        state.priceChart.addLineSeries({
          color: CONFIG.colors.sma100,
          lineWidth: 1,
          title: "SMA 100",
          priceLineVisible: false,
          lastValueVisible: false
        });
      state.volumeSeries =
        state.priceChart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "",
          lastValueVisible: false,
          priceLineVisible: false
        });
      state.volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.82,
          bottom: 0
        }
      });
    }
    if (rsiElement && !state.rsiChart) {
      state.rsiChart = library.createChart(
        rsiElement,
        {
          ...commonOptions,
          width: Math.max(
            280,
            rsiElement.clientWidth || 320
          ),
          height: Math.max(
            110,
            Math.min(
              180,
              rsiElement.clientHeight || 140
            )
          ),
          rightPriceScale: {
            borderColor: CONFIG.colors.grid,
            scaleMargins: {
              top: 0.1,
              bottom: 0.1
            }
          },
          timeScale: {
            ...commonOptions.timeScale,
            visible: false
          }
        }
      );
      state.rsiSeries =
        state.rsiChart.addLineSeries({
          color: CONFIG.colors.rsi,
          lineWidth: 2,
          title: "RSI 14",
          priceLineVisible: false,
          lastValueVisible: true,
          autoscaleInfoProvider: () => ({
            priceRange: {
              minValue: 0,
              maxValue: 100
            }
          })
        });
      // Add the RSI 30/70 guide lines only once.
      state.rsiSeries.createPriceLine({
        price: 30,
        color: "rgba(239,68,68,0.65)",
        lineWidth: 1,
        lineStyle: library.LineStyle?.Dashed ?? 2,
        axisLabelVisible: true,
        title: "30"
      });
      state.rsiSeries.createPriceLine({
        price: 70,
        color: "rgba(34,197,94,0.65)",
        lineWidth: 1,
        lineStyle: library.LineStyle?.Dashed ?? 2,
        axisLabelVisible: true,
        title: "70"
      });
    }
    // Keep the price and RSI charts synchronized.
    if (
      state.priceChart &&
      state.rsiChart &&
      !state.chartsSynchronized
    ) {
      state.priceChart.timeScale()
        .subscribeVisibleLogicalRangeChange(range => {
          if (!range) return;
          try {
            state.rsiChart.timeScale()
              .setVisibleLogicalRange(range);
          } catch (_) {}
        });
      state.rsiChart.timeScale()
        .subscribeVisibleLogicalRangeChange(range => {
          if (!range) return;
          try {
            state.priceChart.timeScale()
              .setVisibleLogicalRange(range);
          } catch (_) {}
        });
      state.chartsSynchronized = true;
    }
    setupChartResize();
  }
  /* ============================================================
     RESPONSIVE CHART RESIZING
     ============================================================ */
  function getPriceChartElement() {
    return getElement(
      "priceChart",
      "mainChart",
      "candlestickChart",
      "chart"
    );
  }
  function getRsiChartElement() {
    return getElement("rsiChart", "rsiGraph");
  }
  function resizeChartElement(element) {
    if (!element) return;
    const width = Math.max(
      280,
      Math.floor(element.clientWidth || 320)
    );
    if (
      state.priceChart &&
      element === getPriceChartElement()
    ) {
      state.priceChart.applyOptions({
        width,
        height: Math.max(
          260,
          Math.min(
            420,
            element.clientHeight ||
              (window.innerWidth < 600 ? 300 : 360)
          )
        )
      });
    }
    if (
      state.rsiChart &&
      element === getRsiChartElement()
    ) {
      state.rsiChart.applyOptions({
        width,
        height: Math.max(
          110,
          Math.min(
            180,
            element.clientHeight || 140
          )
        )
      });
    }
  }
  function resizeCharts() {
    resizeChartElement(getPriceChartElement());
    resizeChartElement(getRsiChartElement());
  }
  function setupChartResize() {
    if (state.resizeObserver) {
      state.resizeObserver.disconnect();
    }
    if (!("ResizeObserver" in window)) {
      window.addEventListener(
        "resize",
        resizeCharts,
        { passive: true }
      );
      return;
    }
    state.resizeObserver = new ResizeObserver(entries => {
      entries.forEach(entry => {
        resizeChartElement(entry.target);
      });
    });
    [
      getPriceChartElement(),
      getRsiChartElement()
    ]
      .filter(Boolean)
      .forEach(element => {
        state.resizeObserver.observe(element);
      });
  }
  /* ============================================================
     RSI CALCULATION
     ============================================================ */
  function getRSIPoints(frame, candles, period = 14) {
    const raw = first(
      frame?.rsi_series,
      frame?.rsiSeries,
      frame?.rsi_values,
      frame?.rsiValues,
      frame?.rsi_history
    );
    if (Array.isArray(raw)) {
      return raw
        .map((point, index) => {
          if (typeof point === "number") {
            return {
              time: candles[index]?.time,
              value: point
            };
          }
          let time = first(
            point?.time,
            point?.timestamp,
            point?.date,
            candles[index]?.time
          );
          if (typeof time === "string") {
            const parsed = Date.parse(time);
            if (Number.isFinite(parsed)) {
              time = Math.floor(parsed / 1000);
            }
          } else if (
            typeof time === "number" &&
            time > 1e12
          ) {
            time = Math.floor(time / 1000);
          }
          return {
            time,
            value: Number(
              first(point?.value, point?.rsi)
            )
          };
        })
        .filter(
          point =>
            point.time != null &&
            Number.isFinite(point.value)
        );
    }
    if (candles.length <= period) {
      return [];
    }
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const difference =
        candles[i].close - candles[i - 1].close;
      if (difference > 0) {
        gains += difference;
      } else {
        losses -= difference;
      }
    }
    let averageGain = gains / period;
    let averageLoss = losses / period;
    const result = [{
      time: candles[period].time,
      value: averageLoss === 0
        ? 100
        : 100 - 100 / (
            1 + averageGain / averageLoss
          )
    }];
    for (
      let i = period + 1;
      i < candles.length;
      i++
    ) {
      const difference =
        candles[i].close - candles[i - 1].close;
      averageGain = (
        averageGain * (period - 1) +
        Math.max(difference, 0)
      ) / period;
      averageLoss = (
        averageLoss * (period - 1) +
        Math.max(-difference, 0)
      ) / period;
      const value = averageLoss === 0
        ? 100
        : 100 - 100 / (
            1 + averageGain / averageLoss
          );
      result.push({
        time: candles[i].time,
        value
      });
    }
    return result;
  }
  /* ============================================================
     CHART METRICS AND RENDERING
     ============================================================ */
  function renderChartMetrics(frame, candles) {
    const last = candles.at(-1);
    const values = {
      chartOpen: last?.open,
      chartHigh: last?.high,
      chartLow: last?.low,
      chartClose: getLastClose(frame, candles),
      chartVolume: last?.volume,
      chartRSI: first(frame?.rsi, frame?.RSI)
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = getElement(id);
      if (!element) return;
      if (value == null) {
        element.textContent = "—";
      } else if (id === "chartVolume") {
        element.textContent = compactNumber(value);
      } else if (id === "chartRSI") {
        element.textContent = formatNumber(value, 1);
      } else {
        element.textContent = formatNumber(value, 2);
      }
    });
  }
  function renderChart() {
    if (!state.latest && !state.selectedSnapshot) {
      return;
    }
    initializeCharts();
    const snapshot =
      state.selectedSnapshot || state.latest;
    const frame = getFrame(
      state.selectedIndex,
      state.selectedTimeframe,
      snapshot
    );
    const candles = getCandles(frame);
    const title = getElement(
      "chartTitle",
      "selectedChartTitle"
    );
    if (title) {
      title.textContent =
        `${state.selectedIndex} · ${state.selectedTimeframe}`;
    }
    const info = getElement(
      "chartInfo",
      "chartSubtitle"
    );
    if (info) {
      const price = getLastClose(frame, candles);
      const changeValue = getChange(frame);
      const rsi = first(frame?.rsi, frame?.RSI);
      info.textContent =
        `Last: ${price == null ? "—" : formatNumber(price)}` +
        ` · Change: ${changeValue == null ? "—" : signedNumber(changeValue, 2, "%")}` +
        ` · RSI: ${formatNumber(rsi, 1)}`;
    }
    const emptyState = getElement(
      "chartEmptyState",
      "chartEmpty"
    );
    if (!candles.length) {
      [
        state.candleSeries,
        state.sma20Series,
        state.sma50Series,
        state.sma100Series,
        state.volumeSeries,
        state.rsiSeries
      ].forEach(series => {
        if (series) series.setData([]);
      });
      if (emptyState) {
        emptyState.hidden = false;
      }
      return;
    }
    if (emptyState) {
      emptyState.hidden = true;
    }
    if (state.candleSeries) {
      state.candleSeries.setData(
        candles.map(candle => ({
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close
        }))
      );
    }
    if (state.sma20Series) {
      state.sma20Series.setData(
        getSMAPoints(
          frame,
          candles,
          "sma20",
          ["SMA20", "sma_20", "SMA_20", "ma20"],
          20
        )
      );
    }
    if (state.sma50Series) {
      state.sma50Series.setData(
        getSMAPoints(
          frame,
          candles,
          "sma50",
          ["SMA50", "sma_50", "SMA_50", "ma50"],
          50
        )
      );
    }
    if (state.sma100Series) {
      state.sma100Series.setData(
        getSMAPoints(
          frame,
          candles,
          "sma100",
          ["SMA100", "sma_100", "SMA_100", "ma100"],
          100
        )
      );
    }
    if (state.volumeSeries) {
      state.volumeSeries.setData(
        candles.map(candle => ({
          time: candle.time,
          value: candle.volume,
          color: candle.close >= candle.open
            ? "rgba(34,197,94,0.38)"
            : "rgba(239,68,68,0.38)"
        }))
      );
    }
    if (state.rsiSeries) {
      state.rsiSeries.setData(
        getRSIPoints(frame, candles)
      );
    }
    try {
      state.priceChart?.timeScale().fitContent();
      state.rsiChart?.timeScale().fitContent();
    } catch (error) {
      console.debug("Chart range update:", error);
    }
    renderChartMetrics(frame, candles);
    resizeCharts();
  }
  /* ============================================================
     INDEX AND TIMEFRAME SELECTORS
     ============================================================ */
  function populateSelectors() {
    const indexSelect = getElement(
      "indexSelect",
      "indexSelector",
      "chartIndexSelect"
    );
    if (
      indexSelect &&
      !indexSelect.dataset.generated
    ) {
      indexSelect.innerHTML = [
        ["Nifty 50", "Nifty 50"],
        ["Bank Nifty", "Bank Nifty"],
        ["Nifty Midcap", "Nifty Midcap"]
      ]
        .map(([value, label]) =>
          `<option value="${value}">${label}</option>`
        )
        .join("");
      indexSelect.dataset.generated = "true";
    }
    if (indexSelect) {
      const hasSelectedOption = [
        ...indexSelect.options
      ].some(option =>
        option.value === state.selectedIndex
      );
      if (!hasSelectedOption) {
        state.selectedIndex =
          indexSelect.options[0]?.value ||
          CONFIG.defaultIndex;
      }
      indexSelect.value = state.selectedIndex;
    }
    const timeframeSelect = getElement(
      "timeframeSelect",
      "timeframeSelector",
      "chartTimeframeSelect"
    );
    if (
      timeframeSelect &&
      !timeframeSelect.dataset.generated
    ) {
      timeframeSelect.innerHTML = [
        ["15m", "15 min"],
        ["30m", "30 min"],
        ["1h", "1 hour"],
        ["Daily", "Daily"]
      ]
        .map(([value, label]) =>
          `<option value="${value}">${label}</option>`
        )
        .join("");
      timeframeSelect.dataset.generated = "true";
    }
    if (timeframeSelect) {
      const hasSelectedOption = [
        ...timeframeSelect.options
      ].some(option =>
        option.value === state.selectedTimeframe
      );
      if (!hasSelectedOption) {
        state.selectedTimeframe =
          timeframeSelect.options[0]?.value ||
          CONFIG.defaultTimeframe;
      }
      timeframeSelect.value =
        state.selectedTimeframe;
    }
  }
    /* ============================================================
     HISTORICAL SNAPSHOTS
     ============================================================ */
  function getHistoryItems(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") {
      return [];
    }
    return toArray(
      first(
        data.snapshots,
        data.history,
        data.items,
        data.records,
        data.files,
        data.dates,
        []
      )
    );
  }
  function getHistoryPath(item) {
    if (typeof item === "string") {
      return item;
    }
    return first(
      item?.url,
      item?.path,
      item?.file,
      item?.filename,
      item?.snapshot,
      item?.data_file,
      item?.dataFile,
      ""
    );
  }
  function getHistoryLabel(item) {
    if (typeof item === "string") {
      const filename = item.split("/").pop() || item;
      return filename
        .replace(/\.json$/i, "")
        .replace(/[_-]/g, " ");
    }
    return first(
      item?.label,
      item?.date,
      item?.timestamp,
      item?.generated_at_ist,
      item?.generated_at,
      item?.name,
      getHistoryPath(item),
      "Historical snapshot"
    );
  }
  function normalizeHistoryPath(path) {
    if (!path) return "";
    const value = String(path).trim();
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
    return value.replace(/^\.?\//, "");
  }
  async function loadHistoryIndex() {
    try {
      const data = await fetchJson(
        CONFIG.historyIndexUrl
      );
      state.history = getHistoryItems(data)
        .map(item => ({
          original: item,
          path: normalizeHistoryPath(
            getHistoryPath(item)
          ),
          label: getHistoryLabel(item),
          timestamp: getTimestamp(
            typeof item === "object" ? item : {}
          )
        }))
        .filter(item => item.path)
        .sort((a, b) => {
          const timeA = Date.parse(
            a.timestamp || a.label
          );
          const timeB = Date.parse(
            b.timestamp || b.label
          );
          if (
            Number.isFinite(timeA) &&
            Number.isFinite(timeB)
          ) {
            return timeB - timeA;
          }
          return String(b.label).localeCompare(
            String(a.label)
          );
        });
      renderHistorySelector();
      return state.history;
    } catch (error) {
      console.warn(
        "Unable to load historical snapshots:",
        error
      );
      state.history = [];
      renderHistorySelector();
      return [];
    }
  }
  function renderHistorySelector() {
    const selector = getElement(
      "historySelect",
      "snapshotSelect",
      "historicalSnapshotSelect"
    );
    const container = getElement(
      "historyList",
      "historyContainer",
      "historicalSnapshots"
    );
    if (selector) {
      const options = [
        '<option value="latest">Latest snapshot</option>',
        ...state.history.map((item, index) => `
          <option value="${index}">
            ${escapeHtml(item.label)}
          </option>
        `)
      ];
      selector.innerHTML = options.join("");
      selector.value = "latest";
    }
    if (container) {
      if (!state.history.length) {
        setHtml(
          container,
          '<div class="empty-state">No historical snapshots available.</div>'
        );
        return;
      }
      setHtml(
        container,
        `
          <button
            type="button"
            class="history-item active"
            data-history-index="latest"
          >
            <span class="history-item-title">
              Latest snapshot
            </span>
            <span class="history-item-date">
              Current dashboard data
            </span>
          </button>
          ${state.history.map((item, index) => `
            <button
              type="button"
              class="history-item"
              data-history-index="${index}"
            >
              <span class="history-item-title">
                ${escapeHtml(item.label)}
              </span>
              <span class="history-item-date">
                ${escapeHtml(
                  item.timestamp
                    ? formatTimestamp(item.timestamp)
                    : item.path
                )}
              </span>
            </button>
          `).join("")}
        `
      );
    }
  }
  async function selectHistorySnapshot(index) {
    if (index === "latest" || index == null) {
      state.selectedSnapshot = null;
      const selector = getElement(
        "historySelect",
        "snapshotSelect",
        "historicalSnapshotSelect"
      );
      if (selector) {
        selector.value = "latest";
      }
      updateHistoryActiveState("latest");
      renderDashboard(state.latest);
      setStatus("Showing latest market snapshot", "success");
      return;
    }
    const historyItem = state.history[Number(index)];
    if (!historyItem || !historyItem.path) {
      setStatus("Historical snapshot not found", "error");
      return;
    }
    try {
      setStatus("Loading historical snapshot…", "info");
      const snapshot = await fetchJson(
        historyItem.path
      );
      state.selectedSnapshot = snapshot;
      const selector = getElement(
        "historySelect",
        "snapshotSelect",
        "historicalSnapshotSelect"
      );
      if (selector) {
        selector.value = String(index);
      }
      updateHistoryActiveState(index);
      renderDashboard(snapshot);
      setStatus(
        `Showing snapshot: ${historyItem.label}`,
        "success"
      );
    } catch (error) {
      console.error(
        "Unable to load historical snapshot:",
        error
      );
      setStatus(
        "Unable to load this historical snapshot",
        "error"
      );
    }
  }
  function updateHistoryActiveState(index) {
    $$("[data-history-index]").forEach(button => {
      const active =
        String(button.dataset.historyIndex) ===
        String(index);
      button.classList.toggle("active", active);
      button.setAttribute(
        "aria-pressed",
        String(active)
      );
    });
  }
  /* ============================================================
     DASHBOARD RENDERING
     ============================================================ */
  function renderDashboard(data) {
    if (!data || typeof data !== "object") {
      setStatus("No valid market data found", "error");
      return;
    }
    renderHeader(data);
    renderIndexCards(data);
    renderScoreBreakdown(data);
    renderOptions(data);
    renderGlobalMarkets(data);
    renderNews(data);
    renderSevenDay(data);
    populateSelectors();
    renderChart();
    const snapshotLabel = getElement(
      "snapshotLabel",
      "dataViewLabel"
    );
    if (snapshotLabel) {
      snapshotLabel.textContent =
        state.selectedSnapshot
          ? "Historical snapshot"
          : "Latest snapshot";
    }
  }
  /* ============================================================
     REFRESH AND CONNECTION STATUS
     ============================================================ */
  async function refreshDashboard(options = {}) {
    if (state.loading) return;
    state.loading = true;
    const showRefreshing = options.showRefreshing !== false;
    if (showRefreshing) {
      setStatus("Refreshing market data…", "info");
    }
    try {
      const latest = await fetchJson(
        CONFIG.latestUrl
      );
      if (
        !latest ||
        typeof latest !== "object" ||
        Array.isArray(latest)
      ) {
        throw new Error(
          "The latest JSON file does not contain an object."
        );
      }
      state.latest = latest;
      // Only replace the visible dashboard if the user is
      // viewing the latest snapshot.
      if (!state.selectedSnapshot) {
        renderDashboard(state.latest);
      }
      setStatus(
        `Data loaded · ${formatTimestamp(getTimestamp(latest))}`,
        "success"
      );
      // Keep the history list reasonably current.
      if (options.loadHistory !== false) {
        await loadHistoryIndex();
      }
    } catch (error) {
      console.error(
        "Dashboard refresh failed:",
        error
      );
      setStatus(
        "Unable to load market data. Check the data files and deployment.",
        "error"
      );
      if (!state.latest) {
        showInitialError(error);
      }
    } finally {
      state.loading = false;
    }
  }
  function showInitialError(error) {
    const candidates = [
      getElement("indexCards"),
      getElement("indicesGrid"),
      getElement("marketCards"),
      getElement("indexOverview")
    ].filter(Boolean);
    const target = candidates[0];
    if (target) {
      target.innerHTML = `
        <div class="empty-state error-state">
          <strong>Market data unavailable</strong>
          <p>
            The dashboard could not load its latest JSON data.
          </p>
          <p class="muted">
            ${escapeHtml(error?.message || "Unknown error")}
          </p>
          <button
            type="button"
            id="retryDashboardButton"
            class="primary-button"
          >
            Retry
          </button>
        </div>
      `;
      getElement("retryDashboardButton")
        ?.addEventListener("click", () => {
          refreshDashboard();
        });
    }
  }
  function setupAutoRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
    }
    state.refreshTimer = window.setInterval(() => {
      refreshDashboard({
        showRefreshing: false,
        loadHistory: false
      });
    }, CONFIG.refreshInterval);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          refreshDashboard({
            showRefreshing: false,
            loadHistory: false
          });
        }
      }
    );
  }
  /* ============================================================
     MOBILE NAVIGATION
     ============================================================ */
  function setupMobileNavigation() {
    const menuButton = getElement(
      "mobileMenuButton",
      "menuToggle",
      "navToggle",
      "hamburgerButton"
    );
    const navigation = getElement(
      "mainNavigation",
      "mainNav",
      "sidebar",
      "dashboardNav"
    );
    if (menuButton && navigation) {
      menuButton.setAttribute(
        "aria-expanded",
        "false"
      );
      menuButton.setAttribute(
        "aria-label",
        "Toggle navigation"
      );
      menuButton.addEventListener("click", () => {
        const isOpen =
          navigation.classList.toggle("is-open");
        menuButton.classList.toggle(
          "is-active",
          isOpen
        );
        menuButton.setAttribute(
          "aria-expanded",
          String(isOpen)
        );
      });
      navigation.addEventListener("click", event => {
        const link = event.target.closest(
          'a[href^="#"]'
        );
        if (!link) return;
        navigation.classList.remove("is-open");
        menuButton.classList.remove("is-active");
        menuButton.setAttribute(
          "aria-expanded",
          "false"
        );
      });
      document.addEventListener("click", event => {
        if (
          !navigation.classList.contains("is-open")
        ) {
          return;
        }
        if (
          navigation.contains(event.target) ||
          menuButton.contains(event.target)
        ) {
          return;
        }
        navigation.classList.remove("is-open");
        menuButton.classList.remove("is-active");
        menuButton.setAttribute(
          "aria-expanded",
          "false"
        );
      });
    }
    // Support section navigation buttons and cards.
    $$("[data-scroll-target]").forEach(button => {
      button.addEventListener("click", () => {
        const targetId =
          button.dataset.scrollTarget;
        const target = document.getElementById(
          targetId
        );
        target?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    });
    // Make anchor navigation account for sticky headers.
    $$('a[href^="#"]').forEach(link => {
      link.addEventListener("click", event => {
        const id = link.getAttribute("href")?.slice(1);
        if (!id) return;
        const target = document.getElementById(id);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
        if (history.replaceState) {
          history.replaceState(null, "", `#${id}`);
        }
      });
    });
  }
  /* ============================================================
     EVENT LISTENERS
     ============================================================ */
  function setupEventListeners() {
    const indexSelect = getElement(
      "indexSelect",
      "indexSelector",
      "chartIndexSelect"
    );
    if (indexSelect) {
      indexSelect.addEventListener("change", () => {
        state.selectedIndex = indexSelect.value;
        renderChart();
      });
    }
    const timeframeSelect = getElement(
      "timeframeSelect",
      "timeframeSelector",
      "chartTimeframeSelect"
    );
    if (timeframeSelect) {
      timeframeSelect.addEventListener("change", () => {
        state.selectedTimeframe =
          timeframeSelect.value;
        renderChart();
      });
    }
    const historySelect = getElement(
      "historySelect",
      "snapshotSelect",
      "historicalSnapshotSelect"
    );
    if (historySelect) {
      historySelect.addEventListener("change", () => {
        selectHistorySnapshot(
          historySelect.value
        );
      });
    }
    $$("[data-history-index]").forEach(button => {
      button.addEventListener("click", () => {
        selectHistorySnapshot(
          button.dataset.historyIndex
        );
      });
    });
    const refreshButton = getElement(
      "refreshButton",
      "refreshData",
      "refreshDashboard"
    );
    if (refreshButton) {
      refreshButton.addEventListener("click", async () => {
        const originalText =
          refreshButton.textContent;
        refreshButton.disabled = true;
        refreshButton.textContent = "Refreshing…";
        try {
          await refreshDashboard({
            showRefreshing: true,
            loadHistory: true
          });
        } finally {
          refreshButton.disabled = false;
          refreshButton.textContent =
            originalText || "Refresh";
        }
      });
    }
    // Show a friendly IST timestamp in the footer if present.
    setText(
      "footerYear",
      new Date().getFullYear()
    );
    // Allow the user to reset the selected view to latest data.
    const latestButton = getElement(
      "latestSnapshotButton",
      "showLatestButton"
    );
    if (latestButton) {
      latestButton.addEventListener("click", () => {
        selectHistorySnapshot("latest");
      });
    }
  }
  /* ============================================================
     ACCESSIBILITY AND BASIC MOBILE POLISH
     ============================================================ */
  function setupAccessibility() {
    $$("button").forEach(button => {
      if (!button.hasAttribute("type")) {
        button.setAttribute("type", "button");
      }
    });
    // Prevent accidental horizontal overflow caused by long text.
    $$("a[target='_blank']").forEach(link => {
      link.setAttribute("rel", "noopener noreferrer");
    });
    // Make chart containers identifiable to screen readers.
    const priceChart = getPriceChartElement();
    const rsiChart = getRsiChartElement();
    if (priceChart && !priceChart.hasAttribute("role")) {
      priceChart.setAttribute("role", "img");
      priceChart.setAttribute(
        "aria-label",
        "Interactive candlestick chart with moving averages and volume"
      );
    }
    if (rsiChart && !rsiChart.hasAttribute("role")) {
      rsiChart.setAttribute("role", "img");
      rsiChart.setAttribute(
        "aria-label",
        "Relative Strength Index chart with 30 and 70 guide levels"
      );
    }
  }
  /* ============================================================
     INITIALIZATION
     ============================================================ */
  async function initializeDashboard() {
    try {
      setupMobileNavigation();
      setupEventListeners();
      setupAccessibility();
      populateSelectors();
      await refreshDashboard({
        showRefreshing: true,
        loadHistory: true
      });
      setupAutoRefresh();
      // If a chart section is initially hidden, resize after layout.
      window.setTimeout(() => {
        resizeCharts();
      }, 250);
      window.setTimeout(() => {
        resizeCharts();
      }, 1000);
    } catch (error) {
      console.error(
        "Dashboard initialization error:",
        error
      );
      setStatus(
        "Dashboard initialization failed",
        "error"
      );
    }
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