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
        text.includes("long buildup")
    ) {
        return "positive";
    }

    if (
        text.includes("bearish") ||
        text.includes("negative") ||
        text.includes("short buildup")
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

    if (type === "call") {
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

    if (type === "put") {
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

    setText("overallScore", `${score.toFixed(1)}`);
    setText("overallLabel", overall.label || "Market bias unavailable");
    setText("scoreGaugeValue", gaugeScore.toFixed(0));
    setText("coverageValue", `${coverage.toFixed(0)}%`);
    setText("dataTimestamp", data.generated_at_ist || data.generated_at || "--");
    setText("sessionSummary", data.market_status || "--");
    setText("marketStatus", data.market_status || "Market status unavailable");
    setText("lastUpdated", data.generated_at_ist || "--");

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
        container.innerHTML = '<div class="loading-card">No index data available.</div>';
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
                    <span class="muted small-text">15m: ${escapeHtml(intraday.label || "--")}</span>
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
            const close = number(t.close);
            const sma20 = number(sma["20"]);
            const sma50 = number(sma["50"]);
            const sma100 = number(sma["100"]);

            return `
                <div class="technical-row">
                    <div>
                        <strong>${escapeHtml(frame)}</strong>
                        <span class="muted small-text">${escapeHtml(t.label || "--")}</span>
                    </div>
                    <div class="technical-values">
                        <span>RSI ${formatNumber(t.rsi, 1)}</span>
                        <span class="status-pill ${cls}">${formatSigned(t.score, 2)}</span>
                    </div>
                    <div class="technical-sma muted small-text">
                        Close ${formatNumber(close)} ·
                        SMA20 ${formatNumber(sma20)} ·
                        SMA50 ${formatNumber(sma50)} ·
                        SMA100 ${formatNumber(sma100)}
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
                <div class="weekly-bar-wrap" title="Session ${index + 1}: ${formatPercent(n)}">
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
        container.innerHTML = '<div class="loading-card">No global market data available.</div>';
        return;
    }

    container.innerHTML = markets.map((market) => {
        const change = number(market.change_pct, 0);
        const category = market.category === "risk" ? "Risk indicator" : "Equity index";

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
        container.innerHTML = '<div class="loading-card">No score components available.</div>';
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
        container.innerHTML = '<div class="loading-card">No news items available.</div>';
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

    return candles.filter((candle) => {
        return (
            chartTime(candle) !== null &&
            number(candle.open) !== null &&
            number(candle.high) !== null &&
            number(candle.low) !== null &&
            number(candle.close) !== null
        );
    });
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
    .filter((candle, index, array) =>
        index === 0 ||
        Number(candle.time) > Number(array[index - 1].time)
    );

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
    const container = byId("historyList");
    if (!container) return;

    try {
        const history = await fetchJson(HISTORY_INDEX_URL);
        state.history = Array.isArray(history) ? history : [];

        if (!state.history.length) {
            container.innerHTML =
                '<div class="loading-card">No historical snapshots are available.</div>';
            return;
        }

        container.innerHTML = state.history.map((item, index) => {
            const filename = String(item.file || "");
            const safeFilename = /^[a-zA-Z0-9._-]+\.json$/.test(filename);

            const date = item.generated_at_ist ||
                item.generated_at ||
                filename;

            const snapshotUrl = safeFilename
                ? `./data/history/${encodeURIComponent(filename)}`
                : "";

            return `
                <div class="history-item">
                    <div class="history-item-copy">
                        <strong>${escapeHtml(date)}</strong>
                        <span class="muted small-text">
                            Score: ${formatNumber(item.score, 2)} ·
                            Nifty: ${formatNumber(item.nifty_close)}
                        </span>
                        <span class="status-pill ${sentimentClass(item.label)}">
                            ${escapeHtml(item.label || "No label")}
                        </span>
                    </div>
                    ${
                        snapshotUrl
                            ? `<button class="text-button history-view-button"
                                type="button"
                                data-history-index="${index}">
                                Inspect snapshot
                            </button>`
                            : ""
                    }
                </div>
            `;
        }).join("");

        container.querySelectorAll("[data-history-index]").forEach((button) => {
            button.addEventListener("click", async () => {
                const index = Number(button.dataset.historyIndex);
                const item = state.history[index];

                if (!item || !item.file) return;

                try {
                    const snapshot = await fetchJson(
                        `./data/history/${encodeURIComponent(item.file)}`
                    );

                    state.data = snapshot;
                    renderDashboard(snapshot);

                    window.scrollTo({
                        top: 0,
                        behavior: "smooth"
                    });

                    showToast("Historical snapshot loaded.");
                } catch (error) {
                    console.error("Could not load historical snapshot:", error);
                    showToast("Could not load this historical snapshot.");
                }
            });
        });
    } catch (error) {
        console.error("History loading failed:", error);

        container.innerHTML =
            '<div class="loading-card">Historical data could not be loaded.</div>';
    }
}

function renderDashboard(data) {
    if (!data || typeof data !== "object") {
        throw new Error("The market data file is not a valid object.");
    }

    state.data = data;

    renderOverall(data);
    renderIndexCards(data);
    renderTechnicalCards(data);
    renderWeeklyCards(data);
    renderOptions(data);
    renderGlobalMarkets(data);
    renderBreakdown(data);
    renderNews(data);
    renderChart();
}

async function loadDashboard(showMessage = false) {
    if (state.loading) return;

    state.loading = true;

    const refreshButton = byId("refreshButton");

    if (refreshButton) {
        refreshButton.disabled = true;
        refreshButton.classList.add("loading");
    }

    setText("dataStatus", "Loading data");

    try {
        const data = await fetchJson(DATA_URL);
        renderDashboard(data);

        if (showMessage) {
            showToast("Market data refreshed.");
        }
    } catch (error) {
        console.error("Dashboard loading failed:", error);

        setText("dataStatus", "Data unavailable");

        if (!state.data) {
            setText("overallLabel", "Unable to load market data");
            setText("scoreNote", "Check your internet connection and try refreshing.");
            setHtml(
                "indexCards",
                '<div class="loading-card">Unable to load market data. Please refresh.</div>'
            );
        }

        if (showMessage) {
            showToast("Refresh failed. Please try again.");
        }
    } finally {
        state.loading = false;

        if (refreshButton) {
            refreshButton.disabled = false;
            refreshButton.classList.remove("loading");
        }
    }
}

function setupControls() {
    const indexSelect = byId("indexSelect");

    if (indexSelect) {
        indexSelect.addEventListener("change", () => {
            state.selectedIndex = indexSelect.value;
            renderChart();
        });
    }

    document.querySelectorAll("[data-timeframe]").forEach((button) => {
        button.addEventListener("click", () => {
            state.selectedTimeframe = button.dataset.timeframe;

            document.querySelectorAll("[data-timeframe]").forEach((item) => {
                item.classList.toggle("active", item === button);
            });

            renderChart();
        });
    });

    const refreshButton = byId("refreshButton");

    if (refreshButton) {
        refreshButton.addEventListener("click", () => {
            loadDashboard(true);
        });
    }

    const backToTop = byId("backToTop");

    if (backToTop) {
        backToTop.addEventListener("click", () => {
            window.scrollTo({
                top: 0,
                behavior: "smooth"
            });
        });
    }

    window.addEventListener("resize", () => {
        state.charts.forEach((chart) => {
            const element = chart.chartElement?.();
            if (element && element.clientWidth > 0) {
                chart.applyOptions({
                    width: element.clientWidth
                });
            }
        });
    });
}

function startDashboard() {
    setupControls();

    loadDashboard(false);
    renderHistory();

    window.setInterval(() => {
        loadDashboard(false);
    }, 5 * 60 * 1000);
}

document.addEventListener("DOMContentLoaded", startDashboard);