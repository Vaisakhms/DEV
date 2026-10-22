"use strict";
const DATA_URL = "./data/latest.json";
const HISTORY_INDEX_URL = "./data/history/index.json";
const state = {
    data: null,
    history: [],
    selectedIndex: "Nifty 50",
    selectedTimeframe: "Daily",
    charts: [],
    loading: false
};
const $ = (id) => document.getElementById(id);
function byId(id) {
    return $(id);
}
function number(value, fallback = null) {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function formatNumber(value, decimals = 2) {
    const n = number(value);
    if (n === null) return "--";
    return n.toLocaleString("en-IN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}
function formatCompact(value) {
    const n = number(value);
    if (n === null) return "--";
    return new Intl.NumberFormat("en-IN", {
        notation: "compact",
        maximumFractionDigits: 2
    }).format(n);
}
function formatPercent(value) {
    const n = number(value);
    if (n === null) return "--";
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function formatSigned(value, decimals = 2) {
    const n = number(value);
    if (n === null) return "--";
    return `${n > 0 ? "+" : ""}${n.toFixed(decimals)}`;
}
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = value ?? "--";
}
function formatDashboardDateTime(value) {
    if (!value) return "--";
    const timestamp = String(value).replace(" ", "T");
    const date = new Date(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(timestamp)
            ? `${timestamp}+05:30`
            : timestamp
    );
    if (Number.isNaN(date.getTime())) return value;
    const day = Number(
        new Intl.DateTimeFormat("en-IN", {
            day: "numeric",
            timeZone: "Asia/Kolkata"
        }).format(date)
    );
    const suffix =
        day >= 11 && day <= 13
            ? "th"
            : day % 10 === 1
                ? "st"
                : day % 10 === 2
                    ? "nd"
                    : day % 10 === 3
                        ? "rd"
                        : "th";
    const datePart = new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Kolkata"
    }).format(date);
    const timePart = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata"
    }).format(date).toUpperCase();
    return `${datePart.replace(/^(\d+)/, `$1${suffix}`)} : ${timePart}`;
}
function setHtml(id, html) {
    const element = byId(id);
    if (element) element.innerHTML = html;
}
function setWidth(id, value) {
    const element = byId(id);
    if (!element) return;
    const n = number(value, 0);
    element.style.width = `${Math.max(0, Math.min(100, n))}%`;
}
function sentimentClass(value) {
    const text = String(value ?? "").toLowerCase();
    if (
        text.includes("bullish") ||
        text.includes("positive") ||
        text.includes("long buildup") ||
        text.includes("short covering")
    ) {
        return "positive";
    }
    if (
        text.includes("bearish") ||
        text.includes("negative") ||
        text.includes("short buildup") ||
        text.includes("long unwinding")
    ) {
        return "negative";
    }
    return "neutral";
}
function optionOiSentiment(buildup, optionType) {
    const value = String(buildup ?? "").toLowerCase();
    const type = String(optionType ?? "").toLowerCase();
    if (
        value.includes("no change") ||
        value.includes("unavailable") ||
        !value
    ) {
        return {
            label: "Neutral",
            className: "neutral"
        };
    }
    if (type === "call" || type === "ce") {
        if (
            value.includes("long buildup") ||
            value.includes("short covering")
        ) {
            return {
                label: "Bullish",
                className: "positive"
            };
        }
        if (
            value.includes("short buildup") ||
            value.includes("long unwinding")
        ) {
            return {
                label: "Bearish",
                className: "negative"
            };
        }
    }
    if (type === "put" || type === "pe") {
        if (
            value.includes("short buildup") ||
            value.includes("long unwinding")
        ) {
            return {
                label: "Bullish",
                className: "positive"
            };
        }
        if (
            value.includes("long buildup") ||
            value.includes("short covering")
        ) {
            return {
                label: "Bearish",
                className: "negative"
            };
        }
    }
    return {
        label: "Neutral",
        className: "neutral"
    };
}
function scoreLabel(score) {
    const n = number(score, 0);
    if (n >= 0.5) return "Bullish";
    if (n <= -0.5) return "Bearish";
    return "Neutral";
}
function scoreToPercent(score) {
    const n = number(score, 0);
    return Math.max(0, Math.min(100, (n + 1) * 50));
}
function showToast(message) {
    const toast = byId("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}
async function fetchJson(url) {
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(
        `${url}${separator}_=${Date.now()}`,
        { cache: "no-store" }
    );
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
}
function renderOverall(data) {
    const overall = data.overall || {};
    const score = number(overall.score, 0);
    const coverage = number(overall.coverage_pct, 0);
    const gaugeScore = Math.max(0, Math.min(100, score));
    setText("overallScore", score.toFixed(1));
    setText("overallLabel", overall.label || "Market bias unavailable");
    setText("scoreGaugeValue", gaugeScore.toFixed(0));
    setText("coverageValue", `${coverage.toFixed(0)}%`);
    setText(
        "dataTimestamp",
        formatDashboardDateTime(data.generated_at_ist || data.generated_at)
    );
    setText("sessionSummary", data.market_status || "--");
    setText("marketStatus", data.market_status || "Market status unavailable");
    setText(
        "lastUpdated",
        formatDashboardDateTime(data.generated_at_ist || data.generated_at)
    );
    setWidth("scoreTrackFill", gaugeScore);
    setWidth("coverageFill", coverage);
    const gauge = byId("scoreGauge");
    if (gauge) {
        gauge.style.background =
            `conic-gradient(var(--accent, #38bdf8) ${gaugeScore * 3.6}deg, var(--border, #263449) 0deg)`;
    }
    setText(
        "scoreNote",
        `Overall model score: ${score.toFixed(2)} out of 100. Coverage: ${coverage.toFixed(0)}%.`
    );
    setText("dataStatus", "Data loaded");
}
function renderIndexCards(data) {
    const container = byId("indexCards");
    if (!container) return;
    const indices = data.indices || {};
    const names = Object.keys(indices);
    if (!names.length) {
        container.innerHTML =
            '<div class="loading-card">No index data available.</div>';
        return;
    }
    container.innerHTML = names.map((name) => {
        const item = indices[name] || {};
        const daily = item.timeframes?.Daily || {};
        const intraday = item.timeframes?.["15m"] || daily;
        const change = number(daily.chg, 0);
        const label = daily.label || "Unavailable";
        const cls = sentimentClass(label);
        return `
            <article class="panel index-card">
                <div class="panel-heading">
                    <div>
                        <span class="eyebrow">${escapeHtml(name)}</span>
                        <h3>${formatNumber(daily.close)}</h3>
                    </div>
                    <span class="change-pill ${change >= 0 ? "positive" : "negative"}">
                        ${formatPercent(change)}
                    </span>
                </div>
                <div class="index-card-footer">
                    <span class="status-pill ${cls}">${escapeHtml(label)}</span>
                    <span class="muted small-text">
                        15m: ${escapeHtml(intraday.label || "--")}
                    </span>
                </div>
                <div class="summary-row">
                    <span>Daily RSI</span>
                    <strong>${formatNumber(daily.rsi, 1)}</strong>
                </div>
                <div class="summary-row">
                    <span>Daily score</span>
                    <strong>${formatSigned(daily.score, 2)}</strong>
                </div>
                <button class="text-button select-index-button"
                    type="button" data-index="${escapeHtml(name)}">
                    View chart
                </button>
            </article>
        `;
    }).join("");
    container.querySelectorAll("[data-index]").forEach((button) => {
        button.addEventListener("click", () => {
            state.selectedIndex = button.dataset.index;
            const select = byId("indexSelect");
            if (select) select.value = state.selectedIndex;
            renderChart();
            byId("priceChart")?.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        });
    });
}
function renderTechnicalCards(data) {
    const container = byId("technicalCards");
    if (!container) return;
    const indices = data.indices || {};
    container.innerHTML = Object.entries(indices).map(([name, item]) => {
        const frames = item.timeframes || {};
        const rows = ["15m", "30m", "1h", "Daily"].map((frame) => {
            const t = frames[frame] || {};
            const sma = t.sma || {};
            const cls = sentimentClass(t.label);
            return `
                <div class="technical-row">
                    <div>
                        <strong>${escapeHtml(frame)}</strong>
                        <span class="muted small-text">
                            ${escapeHtml(t.label || "--")}
                        </span>
                    </div>
                    <div class="technical-values">
                        <span>RSI ${formatNumber(t.rsi, 1)}</span>
                        <span class="status-pill ${cls}">
                            ${formatSigned(t.score, 2)}
                        </span>
                    </div>
                    <div class="technical-sma muted small-text">
                        Close ${formatNumber(t.close)} ·
                        SMA20 ${formatNumber(sma["20"])} ·
                        SMA50 ${formatNumber(sma["50"])} ·
                        SMA100 ${formatNumber(sma["100"])}
                    </div>
                </div>
            `;
        }).join("");
        return `
            <article class="panel technical-card">
                <h3>${escapeHtml(name)}</h3>
                ${rows}
            </article>
        `;
    }).join("");
}
function renderWeeklyCards(data) {
    const container = byId("weeklyCards");
    if (!container) return;
    const indices = data.indices || {};
    container.innerHTML = Object.entries(indices).map(([name, item]) => {
        const week = item.seven_day || {};
        const change = number(week.net, 0);
        const days = Array.isArray(week.chg) ? week.chg : [];
        const bars = days.map((value, index) => {
            const n = number(value, 0);
            const height = Math.max(4, Math.min(100, Math.abs(n) * 25));
            return `
                <div class="weekly-bar-wrap"
                    title="Session ${index + 1}: ${formatPercent(n)}">
                    <div class="weekly-bar ${n >= 0 ? "positive" : "negative"}"
                        style="height:${height}%"></div>
                    <span>${n >= 0 ? "+" : ""}${n.toFixed(1)}</span>
                </div>
            `;
        }).join("");
        return `
            <article class="panel weekly-card">
                <div class="panel-heading">
                    <div>
                        <span class="eyebrow">${escapeHtml(name)}</span>
                        <h3>${formatPercent(change)}</h3>
                    </div>
                    <span class="status-pill ${change >= 0 ? "positive" : "negative"}">
                        ${number(week.up, 0)} positive sessions
                    </span>
                </div>
                <div class="weekly-bars">${bars}</div>
                <div class="summary-row">
                    <span>7-session high</span>
                    <strong>${formatNumber(week.hi)}</strong>
                </div>
                <div class="summary-row">
                    <span>7-session low</span>
                    <strong>${formatNumber(week.lo)}</strong>
                </div>
                <div class="summary-row">
                    <span>Range position</span>
                    <strong>${formatNumber(week.pos, 1)}%</strong>
                </div>
            </article>
        `;
    }).join("");
}
function renderOptions(data) {
    const options = data.options || {};
    const pcr = number(options.pcr);
    const zonePcr = number(options.zone_pcr);
    setText("pcrValue", formatNumber(pcr, 2));
    let pcrDescription = "PCR unavailable";
    if (pcr !== null) {
        if (pcr > 1.2) {
            pcrDescription = "Put open interest is relatively higher";
        } else if (pcr < 0.8) {
            pcrDescription = "Call open interest is relatively higher";
        } else {
            pcrDescription = "PCR is in a relatively balanced range";
        }
    }
    setText("pcrLabel", pcrDescription);
    setText("nearAtmPcr", formatNumber(zonePcr, 2));
    setText("atmStrike", formatNumber(options.atm, 0));
    setText("resistanceValue", formatNumber(options.resistance, 0));
    setText("supportValue", formatNumber(options.support, 0));
    setText(
        "optionsSource",
        `Source: ${options.source || "Unavailable"} | Expiry: ${options.expiry || "--"}`
    );
    const container = byId("optionsCards");
    if (!container) return;
    const contracts = [
        { name: "ATM Call (CE)", data: options.ce || {}, type: "call" },
        { name: "ATM Put (PE)", data: options.pe || {}, type: "put" }
    ];
    container.innerHTML = contracts.map((contract) => {
        const item = contract.data;
        const change = number(item.ltpch, 0);
        const sentiment = optionOiSentiment(item.buildup, contract.type);
        return `
            <article class="panel option-card">
                <div class="panel-heading">
                    <div>
                        <span class="eyebrow">${escapeHtml(contract.name)}</span>
                        <h3>${formatNumber(item.ltp)}</h3>
                    </div>
                    <span class="change-pill ${change >= 0 ? "positive" : "negative"}">
                        ${formatSigned(change)}
                    </span>
                </div>
                <div class="summary-row">
                    <span>Open interest</span>
                    <strong>${formatCompact(item.oi)}</strong>
                </div>
                <div class="summary-row">
                    <span>Change in OI</span>
                    <strong>${formatCompact(item.oich)}</strong>
                </div>
                <div class="summary-row">
                    <span>Positioning</span>
                    <strong class="status-pill ${sentimentClass(item.buildup)}">
                        ${escapeHtml(item.buildup || "--")}
                    </strong>
                </div>
                <div class="summary-row">
                    <span>OI sentiment</span>
                    <strong class="status-pill ${sentiment.className}">
                        ${sentiment.label}
                    </strong>
                </div>
            </article>
        `;
    }).join("");
}
function renderGlobalMarkets(data) {
    const container = byId("globalCards");
    if (!container) return;
    const markets = Array.isArray(data.global_markets)
        ? data.global_markets
        : [];
    if (!markets.length) {
        container.innerHTML =
            '<div class="loading-card">No global market data available.</div>';
        return;
    }
    container.innerHTML = markets.map((market) => {
        const change = number(market.change_pct, 0);
        const category = market.category === "risk"
            ? "Risk indicator"
            : "Equity index";
        return `
            <article class="panel global-card">
                <div class="panel-heading">
                    <div>
                        <span class="eyebrow">${escapeHtml(category)}</span>
                        <h3>${escapeHtml(market.name || market.ticker || "Market")}</h3>
                    </div>
                    <span class="change-pill ${change >= 0 ? "positive" : "negative"}">
                        ${formatPercent(change)}
                    </span>
                </div>
                <div class="global-price">${formatNumber(market.price)}</div>
                <div class="muted small-text">${escapeHtml(market.ticker || "")}</div>
            </article>
        `;
    }).join("");
}
function renderBreakdown(data) {
    const container = byId("scoreBreakdown");
    if (!container) return;
    const scores = data.scores || {};
    const components = Array.isArray(scores.components)
        ? scores.components
        : [];
    if (!components.length) {
        container.innerHTML =
            '<div class="loading-card">No score components available.</div>';
        return;
    }
    container.innerHTML = components.map((item) => {
        const contribution = number(item.contribution, 0);
        const score = number(item.score, 0);
        const weight = number(item.weight, 0);
        return `
            <div class="breakdown-row">
                <div class="breakdown-factor">
                    <strong>${escapeHtml(item.name || "Analysis factor")}</strong>
                    <span class="muted small-text">
                        Weight ${weight.toFixed(0)}% · Score ${formatSigned(score, 2)}
                    </span>
                </div>
                <div class="breakdown-contribution ${contribution >= 0 ? "positive" : "negative"}">
                    ${formatSigned(contribution, 2)}
                </div>
            </div>
        `;
    }).join("");
}
function safeHttpUrl(value) {
    if (!value) return "";
    try {
        const url = new URL(value, window.location.href);
        if (url.protocol === "https:" || url.protocol === "http:") {
            return url.href;
        }
    } catch (error) {
        return "";
    }
    return "";
}
function renderNews(data) {
    const news = data.news || {};
    const items = Array.isArray(news.items) ? news.items : [];
    setText(
        "newsSummary",
        `News sentiment score: ${formatSigned(news.score, 2)} | ${items.length} news items`
    );
    const container = byId("newsCards");
    if (!container) return;
    if (!items.length) {
        container.innerHTML =
            '<div class="loading-card">No news items available.</div>';
        return;
    }
    container.innerHTML = items.slice(0, 12).map((item) => {
        const title = item.title || "Untitled news item";
        const source = item.source || "News source";
        const tags = Array.isArray(item.tags) ? item.tags : [];
        const age = number(item.age);
        const ageText = age === null
            ? ""
            : age < 24
                ? `${age.toFixed(1)} hours ago`
                : `${(age / 24).toFixed(1)} days ago`;
        const tagHtml = tags.map((tag) =>
            `<span class="news-tag">${escapeHtml(tag)}</span>`
        ).join("");
        const safeUrl = safeHttpUrl(item.url);
        return `
            <article class="panel news-card">
                <div class="news-card-meta">
                    <span>${escapeHtml(source)}</span>
                    <span>${escapeHtml(ageText)}</span>
                </div>
                <h3>${escapeHtml(title)}</h3>
                <div class="news-tags">${tagHtml}</div>
                ${
                    safeUrl
                        ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">Read story ↗</a>`
                        : ""
                }
            </article>
        `;
    }).join("");
}
function clearCharts() {
    state.charts.forEach((chart) => {
        try {
            if (chart.__resizeObserver) {
                chart.__resizeObserver.disconnect();
            }
            chart.remove();
        } catch (error) {
            console.warn("Chart cleanup warning:", error);
        }
    });
    state.charts = [];
}
function addChart(container, options) {
    if (!container || !window.LightweightCharts) return null;
    container.innerHTML = "";
    const chart = window.LightweightCharts.createChart(container, {
        width: Math.max(280, container.clientWidth),
        height: options.height || 240,
        layout: {
            background: { color: "transparent" },
            textColor: "#94a3b8",
            fontFamily: "DM Sans, sans-serif"
        },
        grid: {
            vertLines: { color: "rgba(148,163,184,0.10)" },
            horzLines: { color: "rgba(148,163,184,0.10)" }
        },
        rightPriceScale: {
            borderColor: "rgba(148,163,184,0.20)"
        },
        timeScale: {
            borderColor: "rgba(148,163,184,0.20)",
            timeVisible: options.timeVisible !== false,
            secondsVisible: false
        },
        crosshair: {
            mode: 0
        },
        handleScroll: true,
        handleScale: true
    });
    state.charts.push(chart);
    if (window.ResizeObserver) {
        const observer = new ResizeObserver(() => {
            if (container.clientWidth > 0) {
                chart.applyOptions({
                    width: container.clientWidth
                });
            }
        });
        observer.observe(container);
        chart.__resizeObserver = observer;
    }
    return chart;
}
function chartTime(candle) {
    const t = number(candle.time);
    return t === null ? null : t;
}
function validCandles(candles) {
    if (!Array.isArray(candles)) return [];
    return candles.filter((candle) => (
        chartTime(candle) !== null &&
        number(candle.open) !== null &&
        number(candle.high) !== null &&
        number(candle.low) !== null &&
        number(candle.close) !== null
    ));
}
function renderChart() {
    const data = state.data;
    if (!data) return;
    const indexData = data.indices?.[state.selectedIndex];
    if (!indexData) {
        setText("chartInstrument", state.selectedIndex);
        setText("chartPrice", "--");
        setText("chartChange", "No data");
        return;
    }
    const timeframe = state.selectedTimeframe;
    const timeframeData = indexData.timeframes?.[timeframe] || {};
    const candles = validCandles(indexData.charts?.[timeframe] || [])
        .sort((a, b) => Number(a.time) - Number(b.time))
        .filter((candle, index, array) => (
            index === 0 ||
            Number(candle.time) > Number(array[index - 1].time)
        ));
    setText("chartInstrument", `${state.selectedIndex} · ${timeframe}`);
    setText("chartPrice", formatNumber(timeframeData.close));
    const change = number(timeframeData.chg, 0);
    setText("chartChange", formatPercent(change));
    const changeElement = byId("chartChange");
    if (changeElement) {
        changeElement.classList.toggle("positive", change >= 0);
        changeElement.classList.toggle("negative", change < 0);
    }
    setText("candleCount", `${candles.length} candles`);
    clearCharts();
    const priceContainer = byId("priceChart");
    const volumeContainer = byId("volumeChart");
    const rsiContainer = byId("rsiChart");
    if (!candles.length) {
        if (priceContainer) {
            priceContainer.innerHTML =
                '<div class="chart-placeholder">No candle data available for this timeframe.</div>';
        }
        if (volumeContainer) volumeContainer.innerHTML = "";
        if (rsiContainer) rsiContainer.innerHTML = "";
        return;
    }
    if (!window.LightweightCharts) {
        if (priceContainer) {
            priceContainer.innerHTML =
                '<div class="chart-placeholder">Chart library is unavailable. Refresh the page to retry.</div>';
        }
        return;
    }
    const latestClose = Number(candles[candles.length - 1].close);
    const priceMin = latestClose - 250;
    const priceMax = latestClose + 250;
    const fixedPriceRange = () => ({
        priceRange: {
            minValue: priceMin,
            maxValue: priceMax
        }
    });
    const priceChart = addChart(priceContainer, { height: 300 });
    if (!priceChart) return;
    const candleSeries = priceChart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderUpColor: "#22c55e",
        borderDownColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
        autoscaleInfoProvider: fixedPriceRange
    });
    candleSeries.setData(candles.map((candle) => ({
        time: chartTime(candle),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close)
    })));
    const lineDefinitions = [
        { key: "sma20", name: "SMA 20", color: "#38bdf8" },
        { key: "sma50", name: "SMA 50", color: "#f59e0b" },
        { key: "sma100", name: "SMA 100", color: "#a78bfa" }
    ];
    lineDefinitions.forEach((definition) => {
        const values = candles
            .filter((candle) => number(candle[definition.key]) !== null)
            .map((candle) => ({
                time: chartTime(candle),
                value: Number(candle[definition.key])
            }));
        if (!values.length) return;
        const series = priceChart.addLineSeries({
            color: definition.color,
            lineWidth: 2,
            title: definition.name,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: fixedPriceRange
        });
        series.setData(values);
    });
    priceChart.timeScale().fitContent();
    const volumeChart = addChart(volumeContainer, {
        height: 110,
        timeVisible: true
    });
    if (volumeChart) {
        const volumeSeries = volumeChart.addHistogramSeries({
            priceFormat: { type: "volume" },
            priceScaleId: ""
        });
        volumeSeries.setData(candles.map((candle) => ({
            time: chartTime(candle),
            value: Math.max(0, number(candle.volume, 0)),
            color: Number(candle.close) >= Number(candle.open)
                ? "rgba(34,197,94,0.65)"
                : "rgba(239,68,68,0.65)"
        })));
        volumeChart.timeScale().fitContent();
    }
    const rsiChart = addChart(rsiContainer, {
        height: 110,
        timeVisible: true
    });
    if (rsiChart) {
        const rsiValues = candles
            .filter((candle) => number(candle.rsi) !== null)
            .map((candle) => ({
                time: chartTime(candle),
                value: Number(candle.rsi)
            }));
        if (rsiValues.length) {
            const rsiSeries = rsiChart.addLineSeries({
                color: "#c084fc",
                lineWidth: 2,
                title: "RSI",
                priceLineVisible: false
            });
            rsiSeries.setData(rsiValues);
            rsiChart.priceScale("right").applyOptions({
                autoScale: false,
                scaleMargins: { top: 0.1, bottom: 0.1 }
            });
            rsiChart.applyOptions({
                rightPriceScale: {
                    scaleMargins: { top: 0.1, bottom: 0.1 }
                }
            });
        } else if (rsiContainer) {
            rsiContainer.innerHTML =
                '<div class="chart-placeholder">RSI data is not available for these candles.</div>';
        }
        rsiChart.timeScale().fitContent();
    }
    const visibleRange = {
        from: Math.max(0, candles.length - 60),
        to: candles.length + 2
    };
    state.charts.forEach((chart) => {
        chart.timeScale().setVisibleLogicalRange(visibleRange);
    });
    syncChartTimeScales();
}
function syncChartTimeScales() {
    if (state.charts.length < 2) return;
    const mainChart = state.charts[0];
    mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range) return;
        state.charts.slice(1).forEach((chart) => {
            try {
                chart.timeScale().setVisibleLogicalRange(range);
            } catch (error) {
                // Ignore chart synchronization errors.
            }
        });
    });
}
async function renderHistory() {
  const container = byId("historyContainer");
  if (!container) return;
  try {
    const history = await fetchJson(HISTORY_INDEX_URL);
    const files = Array.isArray(history)
      ? history
      : Array.isArray(history?.files)
        ? history.files
        : Array.isArray(history?.history)
          ? history.history
          : [];
    if (!files.length) {
      container.innerHTML = '<p class="muted">No historical reports available yet.</p>';
      return;
    }
    const items = files
      .slice()
      .sort((a, b) => {
        const aTime = new Date(a.generated_at || a.date || a).getTime() || 0;
        const bTime = new Date(b.generated_at || b.date || b).getTime() || 0;
        return bTime - aTime;
      })
      .slice(0, 10);
    container.innerHTML = items.map((item) => {
      const label = typeof item === "string"
        ? item
        : item.label || item.generated_at || item.date || item.filename || "Historical report";
      const url = typeof item === "string"
        ? item
        : item.url || item.path || item.filename || "";
      const safeUrl = safeHttpUrl(url);
      return `
        <div class="history-item">
          <span>${escapeHtml(label)}</span>
          ${
            safeUrl
              ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">View</a>`
              : '<span class="muted">Unavailable</span>'
          }
        </div>
      `;
    }).join("");
  } catch (error) {
    console.warn("Unable to load history:", error);
    container.innerHTML = '<p class="muted">Historical reports are not available right now.</p>';
  }
}
/* =========================================================
   PRICE ACTION CRITERIA AND NIFTY ATM BIAS
   ========================================================= */
function getTimeframeData(data, indexName, timeframe = "15m") {
  return data?.indices?.[indexName]?.timeframes?.[timeframe] || null;
}
function getCloseValue(timeframeData) {
  if (!timeframeData) return null;
  const candidates = [
    timeframeData.close,
    timeframeData.price,
    timeframeData.last_price,
    timeframeData.ltp
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}
function getMovingAverage(timeframeData, period) {
  if (!timeframeData) return null;
  const possibleKeys = [
    `sma${period}`,
    `SMA${period}`,
    `sma_${period}`,
    `SMA_${period}`
  ];
  for (const key of possibleKeys) {
    const value = Number(timeframeData[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const smaObject = timeframeData.sma || timeframeData.smas || {};
  const nestedValue = Number(
    smaObject[period] ??
    smaObject[String(period)] ??
    smaObject[`sma${period}`] ??
    smaObject[`SMA${period}`]
  );
  return Number.isFinite(nestedValue) && nestedValue > 0
    ? nestedValue
    : null;
}
function getIndexTrend(data, indexName) {
  const tf = getTimeframeData(data, indexName, "15m");
  const close = getCloseValue(tf);
  const sma20 = getMovingAverage(tf, 20);
  const sma50 = getMovingAverage(tf, 50);
  const sma100 = getMovingAverage(tf, 100);
  if (
    close === null ||
    sma20 === null ||
    sma50 === null ||
    sma100 === null
  ) {
    return {
      name: indexName,
      direction: "neutral",
      label: "Insufficient data",
      close,
      sma20,
      sma50,
      sma100,
      reason: "Price or one or more moving averages are unavailable."
    };
  }
  if (close > sma20 && sma20 > sma50 && sma50 > sma100) {
    return {
      name: indexName,
      direction: "bullish",
      label: "Bullish",
      close,
      sma20,
      sma50,
      sma100,
      reason: "Price is above SMA 20, 50 and 100, with bullish moving-average alignment."
    };
  }
  if (close < sma20 && sma20 < sma50 && sma50 < sma100) {
    return {
      name: indexName,
      direction: "bearish",
      label: "Bearish",
      close,
      sma20,
      sma50,
      sma100,
      reason: "Price is below SMA 20, 50 and 100, with bearish moving-average alignment."
    };
  }
  return {
    name: indexName,
    direction: "neutral",
    label: "Mixed",
    close,
    sma20,
    sma50,
    sma100,
    reason: "Price and moving averages are not fully aligned."
  };
}
function getOptionsData(data) {
  return data?.options || data?.option_chain || data?.optionChain || null;
}
function getOptionBuildup(options, side) {
  const contract = options?.[side.toLowerCase()];
  if (!contract) return "";
  const candidates = [
    contract.buildup,
    contract.build_up,
    contract.sentiment,
    contract.label,
    contract.status
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}
function classifyOptionBuildup(buildup, side) {
  const value = String(buildup || "").toLowerCase();
  if (value.includes("long buildup") || value.includes("long build-up")) {
    return side === "CE" ? "bullish" : "bearish";
  }
  if (value.includes("short buildup") || value.includes("short build-up")) {
    return side === "CE" ? "bearish" : "bullish";
  }
  if (value.includes("short covering")) {
    return side === "CE" ? "bullish" : "bearish";
  }
  if (value.includes("long unwinding")) {
    return side === "CE" ? "bearish" : "bullish";
  }
  return "neutral";
}
function getOptionOiBias(data) {
  const options = getOptionsData(data);
  if (!options) {
    return {
      direction: "neutral",
      label: "Unavailable",
      ceBuildup: "",
      peBuildup: "",
      reason: "Option positioning data is unavailable."
    };
  }
  const ceBuildup = getOptionBuildup(options, "CE");
  const peBuildup = getOptionBuildup(options, "PE");
  const ceBias = classifyOptionBuildup(ceBuildup, "CE");
  const peBias = classifyOptionBuildup(peBuildup, "PE");
  if (ceBias === "bullish" && peBias === "bullish") {
    return {
      direction: "bullish",
      label: "Bullish",
      ceBuildup,
      peBuildup,
      reason: "Call and put positioning both indicate a bullish bias."
    };
  }
  if (ceBias === "bearish" && peBias === "bearish") {
    return {
      direction: "bearish",
      label: "Bearish",
      ceBuildup,
      peBuildup,
      reason: "Call and put positioning both indicate a bearish bias."
    };
  }
  return {
    direction: "neutral",
    label: "Mixed / unclear",
    ceBuildup,
    peBuildup,
    reason: "Call and put positioning do not confirm the same direction."
  };
}
function getLevel(options, keys) {
  if (!options) return null;
  for (const key of keys) {
    const value = Number(options[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}
function getNiftyLevels(data) {
  const options = getOptionsData(data);
  const niftyTf = getTimeframeData(data, "Nifty 50", "15m");
  const spot =
    getCloseValue(niftyTf) ??
    getLevel(options, ["spot", "spot_price", "underlyingValue", "underlying_value", "ltp"]);
  const atm = getLevel(options, ["atm", "atm_strike", "atmStrike", "atm_strike_price"]);
  const support = getLevel(options, [
    "support",
    "support_level",
    "max_pe_oi_strike",
    "max_put_oi_strike",
    "put_support"
  ]);
  const resistance = getLevel(options, [
    "resistance",
    "resistance_level",
    "max_ce_oi_strike",
    "max_call_oi_strike",
    "call_resistance"
  ]);
  return { spot, atm, support, resistance };
}
function renderCriteriaTable(data, trends, oiBias) {
  const container = byId("criteriaSummary");
  if (!container) return;
  const niftyTrend = trends.find((item) => item.name === "Nifty 50");
  const bullishCount = trends.filter((item) => item.direction === "bullish").length;
  const bearishCount = trends.filter((item) => item.direction === "bearish").length;
  const mixedCount = trends.length - bullishCount - bearishCount;
  const rows = trends.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td class="${sentimentClass(item.direction)}">${escapeHtml(item.label)}</td>
      <td>${item.close === null ? "—" : formatNumber(item.close)}</td>
      <td>${item.sma20 === null ? "—" : formatNumber(item.sma20)}</td>
      <td>${item.sma50 === null ? "—" : formatNumber(item.sma50)}</td>
      <td>${item.sma100 === null ? "—" : formatNumber(item.sma100)}</td>
    </tr>
  `).join("");
  container.innerHTML = `
    <div class="criteria-summary-top">
      <div class="criteria-stat">
        <span>Indices bullish</span>
        <strong class="positive">${bullishCount}</strong>
      </div>
      <div class="criteria-stat">
        <span>Indices bearish</span>
        <strong class="negative">${bearishCount}</strong>
      </div>
      <div class="criteria-stat">
        <span>Mixed / missing</span>
        <strong>${mixedCount}</strong>
      </div>
      <div class="criteria-stat">
        <span>ATM OI bias</span>
        <strong class="${sentimentClass(oiBias.direction)}">${escapeHtml(oiBias.label)}</strong>
      </div>
    </div>
    <div class="table-scroll">
      <table class="criteria-table">
        <thead>
          <tr>
            <th>Index</th>
            <th>Trend</th>
            <th>Price</th>
            <th>SMA 20</th>
            <th>SMA 50</th>
            <th>SMA 100</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="criteria-note">
      Trend alignment uses the 15-minute price and SMA 20/50/100.
      Mixed or missing values are not treated as confirmation.
    </p>
  `;
}
function renderNiftyTradeDecision(data, trends, oiBias) {
  const container = byId("niftyTradeDecision");
  if (!container) return;
  const levels = getNiftyLevels(data);
  const niftyTrend = trends.find((item) => item.name === "Nifty 50");
  const bullishCount = trends.filter((item) => item.direction === "bullish").length;
  const bearishCount = trends.filter((item) => item.direction === "bearish").length;
  const reasons = [];
  const conflicts = [];
  let decision = "WAIT";
  let decisionClass = "neutral";
  let confirmation = "Wait for the 15-minute trend and option positioning to agree.";
  let invalidation = "Reassess if price loses the aligned moving averages or the OI bias changes.";
  if (!niftyTrend || niftyTrend.direction === "neutral") {
    conflicts.push("Nifty's 15-minute price and SMA 20/50/100 are not fully aligned or data is missing.");
  } else {
    reasons.push(niftyTrend.reason);
  }
  if (bullishCount >= 3 && niftyTrend?.direction === "bullish") {
    reasons.push(`${bullishCount} of ${trends.length} tracked indices show bullish moving-average alignment.`);
  } else if (bearishCount >= 3 && niftyTrend?.direction === "bearish") {
    reasons.push(`${bearishCount} of ${trends.length} tracked indices show bearish moving-average alignment.`);
  } else {
    conflicts.push("Fewer than three tracked indices confirm the same direction.");
  }
  if (oiBias.direction === "bullish") {
    reasons.push(`Option positioning supports a bullish bias (${oiBias.ceBuildup || "CE unavailable"}; ${oiBias.peBuildup || "PE unavailable"}).`);
  } else if (oiBias.direction === "bearish") {
    reasons.push(`Option positioning supports a bearish bias (${oiBias.ceBuildup || "CE unavailable"}; ${oiBias.peBuildup || "PE unavailable"}).`);
  } else {
    conflicts.push("Call/put buildup is mixed or unavailable.");
  }
  const bullishConfirmed =
    niftyTrend?.direction === "bullish" &&
    bullishCount >= 3 &&
    oiBias.direction === "bullish";
  const bearishConfirmed =
    niftyTrend?.direction === "bearish" &&
    bearishCount >= 3 &&
    oiBias.direction === "bearish";
  if (bullishConfirmed) {
    decision = "BUY ATM CE BIAS";
    decisionClass = "bullish";
    confirmation = "Prefer confirmation from a completed 15-minute candle holding above the aligned moving averages. Avoid chasing a sharp extension.";
    invalidation = "Reassess if price closes below SMA 20, index alignment weakens, or option positioning turns bearish.";
  } else if (bearishConfirmed) {
    decision = "BUY ATM PE BIAS";
    decisionClass = "bearish";
    confirmation = "Prefer confirmation from a completed 15-minute candle holding below the aligned moving averages. Avoid chasing a sharp extension.";
    invalidation = "Reassess if price closes above SMA 20, index alignment weakens, or option positioning turns bullish.";
  }
  if (levels.spot && levels.resistance && levels.spot < levels.resistance && decision === "BUY ATM CE BIAS") {
    conflicts.push("Spot is below the listed resistance level; a breakout has not been established by these inputs.");
    decision = "WAIT";
    decisionClass = "neutral";
    confirmation = "Wait for a confirmed move above resistance, or a clean pullback that holds support.";
  }
  if (levels.spot && levels.support && levels.spot > levels.support && decision === "BUY ATM PE BIAS") {
    conflicts.push("Spot is above the listed support level; a breakdown has not been established by these inputs.");
    decision = "WAIT";
    decisionClass = "neutral";
    confirmation = "Wait for a confirmed move below support, or a failed retest from underneath.";
  }
  const spotText = levels.spot ? formatNumber(levels.spot) : "Unavailable";
  const atmText = levels.atm ? formatNumber(levels.atm) : "Unavailable";
  container.innerHTML = `
    <div class="trade-decision-header">
      <div>
        <span class="trade-eyebrow">NIFTY • ATM OPTIONS • BIAS ONLY</span>
        <h3 class="trade-decision-value ${decisionClass}">${escapeHtml(decision)}</h3>
      </div>
      <div class="trade-key-metrics">
        <div><span>Nifty spot</span><strong>${escapeHtml(spotText)}</strong></div>
        <div><span>ATM strike</span><strong>${escapeHtml(atmText)}</strong></div>
      </div>
    </div>
    <div class="trade-levels">
      <div><span>Support</span><strong>${levels.support ? escapeHtml(formatNumber(levels.support)) : "—"}</strong></div>
      <div><span>Resistance</span><strong>${levels.resistance ? escapeHtml(formatNumber(levels.resistance)) : "—"}</strong></div>
      <div><span>CE buildup</span><strong>${escapeHtml(oiBias.ceBuildup || "Unavailable")}</strong></div>
      <div><span>PE buildup</span><strong>${escapeHtml(oiBias.peBuildup || "Unavailable")}</strong></div>
    </div>
    <div class="trade-explanation-grid">
      <div>
        <h4>Why</h4>
        ${
          reasons.length
            ? `<ul>${reasons.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
            : "<p>Not enough confirming evidence.</p>"
        }
      </div>
      <div>
        <h4>Conflicts / risks</h4>
        ${
          conflicts.length
            ? `<ul>${conflicts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
            : "<p>No major conflict detected by the available criteria.</p>"
        }
      </div>
    </div>
    <div class="trade-confirmation">
      <p><strong>Confirmation:</strong> ${escapeHtml(confirmation)}</p>
      <p><strong>Invalidation:</strong> ${escapeHtml(invalidation)}</p>
    </div>
    <p class="trade-disclaimer">
      This is a rule-based market bias, not a guaranteed trade signal.
      Verify live prices, candle completion, liquidity, risk and stop-loss before acting.
      Missing or conflicting data should mean WAIT.
    </p>
  `;
}
function renderPriceActionDecision(data) {
  const indexNames = [
    "Nifty 50",
    "Bank Nifty",
    "Nifty Midcap",
    "Nifty 100"
  ];
  const trends = indexNames.map((name) => getIndexTrend(data, name));
  const oiBias = getOptionOiBias(data);
  renderCriteriaTable(data, trends, oiBias);
  renderNiftyTradeDecision(data, trends, oiBias);
}
/* =========================================================
   DASHBOARD RENDERING
   ========================================================= */
function renderDashboard(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Dashboard data is empty or invalid.");
  }
  renderOverall(data);
  renderIndexCards(data);
  renderTechnicalCards(data);
  renderWeeklyCards(data);
  renderOptions(data);
  renderGlobalMarkets(data);
  renderBreakdown(data);
  renderNews(data);
  renderPriceActionDecision(data);
  const generatedAt =
    data.generated_at ||
    data.generatedAt ||
    data.timestamp ||
    data.updated_at;
  if (generatedAt) {
    const formatted = formatDashboardDateTime(generatedAt);
    setText("lastUpdated", formatted);
    setText("lastUpdatedTime", formatted);
  }
  setText("dashboardStatus", "Live data loaded");
  setText("marketStatus", data.market_status || data.marketStatus || "Market status unavailable");
}
async function loadDashboard() {
  const refreshButton = byId("refreshButton");
  if (refreshButton) refreshButton.disabled = true;
  setText("dashboardStatus", "Refreshing market data…");
  try {
    const data = await fetchJson(DATA_URL);
    state.data = data;
    renderDashboard(data);
    try {
      await renderHistory();
    } catch (historyError) {
      console.warn("History loading failed:", historyError);
    }
    if (typeof window.renderCharts === "function") {
      window.renderCharts(data);
    }
    showToast("Dashboard updated");
  } catch (error) {
    console.error("Dashboard refresh failed:", error);
    setText("dashboardStatus", "Unable to refresh data");
    const decisionContainer = byId("niftyTradeDecision");
    if (decisionContainer) {
      decisionContainer.innerHTML = `
        <h3>Market decision unavailable</h3>
        <p>Unable to load the latest market data. Please refresh and try again.</p>
      `;
    }
    const criteriaContainer = byId("criteriaSummary");
    if (criteriaContainer) {
      criteriaContainer.innerHTML = `
        <p class="muted">Market criteria could not be loaded. Check your connection and try again.</p>
      `;
    }
    showToast("Could not load market data");
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}
/* =========================================================
   DASHBOARD CONTROLS
   ========================================================= */
function setupControls() {
  const refreshButton = byId("refreshButton");
  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      loadDashboard();
    });
  }
  const chartIndexSelect = byId("chartIndex");
  const chartTimeframeSelect = byId("chartTimeframe");
  function refreshCharts() {
    if (state.data && typeof window.renderCharts === "function") {
      window.renderCharts(state.data);
    }
  }
  if (chartIndexSelect) {
    chartIndexSelect.addEventListener("change", refreshCharts);
  }
  if (chartTimeframeSelect) {
    chartTimeframeSelect.addEventListener("change", refreshCharts);
  }
  const autoRefreshSelect = byId("autoRefresh");
  if (autoRefreshSelect) {
    autoRefreshSelect.addEventListener("change", () => {
      const seconds = Number(autoRefreshSelect.value);
      if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
        state.refreshTimer = null;
      }
      if (Number.isFinite(seconds) && seconds > 0) {
        state.refreshTimer = setInterval(() => {
          loadDashboard();
        }, seconds * 1000);
      }
    });
  }
}
/* =========================================================
   STARTUP
   ========================================================= */
function startDashboard() {
  setupControls();
  loadDashboard();
  // Refresh every 60 seconds by default.
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
  }
  state.refreshTimer = setInterval(() => {
    loadDashboard();
  }, 60000);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startDashboard);
} else {
  startDashboard();
}