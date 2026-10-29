"""News impact scoring and the gap outlook.

Everything that decides a score is a pure function so it can be unit tested.
Network fetchers are small, fail-soft and return None / [] on any problem.
"""

import datetime
import email.utils
import html
import re
import xml.etree.ElementTree as ET
from urllib.parse import quote_plus

import requests

IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))

NEWS_WINDOW_HOURS = 24
TOP_NEWS_COUNT = 5
MAX_NEWS_ITEMS = 15
MIN_RELEVANT_IMPACT = 4
HEADERS = {"User-Agent": "Mozilla/5.0"}

RSS_FEEDS = [
    {
        "name": "Firstpost",
        "url": "https://www.firstpost.com/commonfeeds/v1/mfp/rss/business.xml",
    },
]

GOOGLE_NEWS_QUERIES = [
    'Nifty OR Sensex OR "Indian stock market"',
    'RBI OR "Federal Reserve" OR inflation OR "interest rate"',
    '"crude oil" OR war OR tariff OR sanctions stocks',
    'FII OR FPI OR "foreign investors" India',
]

GIFT_NIFTY_URL = "https://in.tradingview.com/symbols/NSEIX-NIFTY1!/"

# Gap signal weights (percent of the outlook score).
SIGNAL_WEIGHTS = {
    "gift": 30,
    "us_futures": 20,
    "asia": 10,
    "vix": 5,
    "flows": 10,
    "risk": 10,
    "news": 15,
}


def clamp(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


# ============================================================
# NEWS CLASSIFICATION
# ============================================================

def _rx(pattern):
    return re.compile(pattern, re.I)


# base = how much a story on this subject can move the market (0-10).
TOPICS = [
    {
        "tag": "Geopolitics", "base": 8,
        "rx": _rx(
            r"\b(wars?|invasion|invad\w+|missiles?|air ?strikes?|"
            r"military (?:strikes?|action)|hostilities|escalat\w+|ceasefire|"
            r"truce|peace (?:deal|talks|agreement)|terror\w*|geopolitic\w*|"
            r"attacks?|sanctions?|border clash\w*)\b"
        ),
    },
    {
        "tag": "Systemic risk", "base": 9,
        "rx": _rx(
            r"\b(default\w*|bankruptcy|insolven\w+|bank run|banking crisis|"
            r"credit crisis|financial crisis|contagion|meltdown|"
            r"circuit breaker|trading halt)\b"
        ),
    },
    {
        "tag": "Central bank", "base": 6,
        "rx": _rx(
            r"\b(RBI|Reserve Bank|Federal Reserve|(?-i:Fed)|FOMC|ECB|"
            r"Bank of Japan|BoJ|Bank of England|MPC|repo rate|policy rate|"
            r"interest rates?|rate (?:cuts?|hikes?)|monetary policy|Powell)\b"
        ),
        "boost": _rx(
            r"\b(holds?|cuts?|hikes?|raises?|lowers?|keeps?|pauses?|"
            r"slashes|unchanged)\b"
        ),
    },
    {
        "tag": "Crude/Energy", "base": 7,
        "rx": _rx(
            r"\b(crude|brent|WTI|oil (?:prices?|shock|supply)|OPEC\+?|"
            r"energy (?:shock|crisis|prices?)|fuel (?:prices?|costs?)|"
            r"natural gas|LNG)\b"
        ),
    },
    {
        "tag": "Trade/Tariff", "base": 7,
        "rx": _rx(
            r"\b(tariffs?|trade (?:war|deal|talks|curbs?)|export (?:curbs?|ban)|"
            r"import dut(?:y|ies)|embargo)\b"
        ),
    },
    {
        "tag": "FII/DII flows", "base": 6,
        "rx": _rx(
            r"\b(FIIs?|FPIs?|DIIs?|foreign (?:institutional |portfolio )?"
            r"(?:investors?|inflows?|outflows?))\b"
        ),
    },
    {
        "tag": "Indian market", "base": 6,
        "rx": _rx(
            r"\b(Nifty|Sensex|Bank Nifty|Dalal Street|Indian (?:stock )?markets?|"
            r"market crash|India VIX)\b"
        ),
    },
    {
        "tag": "Macro data", "base": 5,
        "rx": _rx(
            r"\b(GDP|CPI|WPI|inflation|PMI|IIP|jobs? report|payrolls?|"
            r"unemployment|retail sales|fiscal deficit|current account|"
            r"trade deficit|industrial output|(?:bond|treasury) yields?|"
            r"10-year yield)\b"
        ),
    },
    {
        "tag": "Policy/Budget", "base": 5,
        "rx": _rx(
            r"\b(Union Budget|budget|GST|elections?|Lok Sabha|SEBI|"
            r"capital gains tax)\b"
        ),
    },
    {
        "tag": "Rupee", "base": 5,
        "rx": _rx(r"\b(rupee|USD/INR|dollar index|DXY)\b"),
    },
    {
        "tag": "Heavyweight", "base": 4,
        "rx": _rx(
            r"\b(Reliance|HDFC Bank|ICICI Bank|Infosys|TCS|SBI|"
            r"State Bank of India|Bharti Airtel|Larsen|L&T|ITC|Axis Bank|"
            r"Kotak)\b"
        ),
        "boost": _rx(
            r"\b(results?|earnings|Q[1-4]|profit|loss|guidance|order)\b"
        ),
    },
    {
        "tag": "Global equities", "base": 4,
        "rx": _rx(
            r"\b(Wall Street|S&P 500|Nasdaq|Dow Jones|Dow|Nvidia|Alphabet|"
            r"Google|Microsoft|Apple|Amazon|Meta|Tesla|Samsung|"
            r"AI (?:bubble|spending|boom))\b"
        ),
    },
    {
        "tag": "US policy", "base": 4,
        "rx": _rx(r"\b(Trump|White House|US Treasury)\b"),
    },
]

INTENSITY_RX = _rx(
    r"\b(plung\w+|crash\w*|surg\w+|soar\w*|spik\w+|tumbl\w+|record|shock|"
    r"emergency|historic|biggest|sharpest|worst|panic|collapse\w*|slump\w*|"
    r"rout|rall(?:y|ies|ied)|jump\w*)\b"
)

POS_RX = _rx(
    r"\b(rall(?:y|ies|ied)|surg\w+|jump\w*|soar\w*|gain\w*|rises?|rose|"
    r"climb\w*|record high|rate cuts?|cuts? (?:interest )?rates?|cools?|"
    r"eases?|easing|inflows?|net buy\w*|upgrad\w+|beats?|rebound\w*|"
    r"recover\w*|optimis\w+|ceasefire|truce|peace|bullish|accelerat\w+|"
    r"boost\w*|relief|trade deal|lifts?|lifted)\b"
)

NEG_RX = _rx(
    r"\b(fall\w*|fell|plung\w+|crash\w*|slump\w*|sell-?off|drops?|dropped|"
    r"slides?|slid|tumbl\w+|declin\w+|rate hikes?|hikes? (?:interest )?rates?|"
    r"outflows?|net sell\w*|selling|downgrad\w+|fears?|recession|war|"
    r"tariffs?|sanctions?|attacks?|missiles?|air ?strikes?|misses|missed|"
    r"loss(?:es)?|warns?|warning|bearish|threat\w*|shock|crisis|default\w*|"
    r"collapse\w*|panic|rout|worr\w+|concerns?|slowdown|escalat\w+|conflict)\b"
)

# For these subjects a rise is bad for Indian equities.
_INVERSE_SUBJECT = (
    r"(?:inflation|cpi|wpi|crude|brent|oil|fuel|yields?|vix|dollar|"
    r"energy prices?|import bill)"
)
_UP = (
    r"(?:surg\w+|ris\w+|rose|jump\w*|spik\w+|soar\w*|climb\w*|"
    r"high(?:er|est)?|hike\w*|accelerat\w+|shock)"
)
_DOWN = (
    r"(?:fall\w*|fell|drop\w*|eas\w+|cool\w*|declin\w+|slid\w*|soften\w*|"
    r"slump\w*|cut\w*)"
)
INVERSE_UP_RX = [
    _rx(r"\b" + _INVERSE_SUBJECT + r"\b[^.;:]{0,40}?\b" + _UP + r"\b"),
    _rx(r"\b(?:high|higher|rising|soaring|surging)\s+(?:crude|oil|fuel|energy)\b"),
]
INVERSE_DOWN_RX = [
    _rx(r"\b" + _INVERSE_SUBJECT + r"\b[^.;:]{0,40}?\b" + _DOWN + r"\b"),
    _rx(
        r"\b(?:falling|lower|declining|easing|cooling|softening|dropping|"
        r"slumping|cheaper)\s+(?:\w+\s+){0,2}?" + _INVERSE_SUBJECT + r"\b"
    ),
]

_TAG_RX = re.compile(r"<[^>]+>")
_SPACE_RX = re.compile(r"\s+")


def clean_text(value):
    text = html.unescape(str(value or ""))
    text = _TAG_RX.sub(" ", text)
    return _SPACE_RX.sub(" ", text).strip()


def classify_news(title, summary=""):
    """Return impact (0-10), direction (-1/0/+1) and display tags."""
    text = clean_text(title)
    detail = clean_text(summary)
    haystack = text + ". " + detail[:240]

    matched = [t for t in TOPICS if t["rx"].search(haystack)]

    if not matched:
        return {"impact": 0.0, "direction": 0, "tags": []}

    scores = []
    for topic in matched:
        base = topic["base"]
        if topic.get("boost") and topic["boost"].search(haystack):
            base += 1
        scores.append(base)

    impact = max(scores)
    impact += min(1.5, 0.5 * (len(matched) - 1))
    intensity = {m.group(0).lower() for m in INTENSITY_RX.finditer(text)}
    impact += min(2, len(intensity))
    impact = round(min(10.0, impact), 1)

    pos = len(POS_RX.findall(text))
    neg = len(NEG_RX.findall(text))
    inverse_neg = any(rx.search(text) for rx in INVERSE_UP_RX)
    inverse_pos = any(rx.search(text) for rx in INVERSE_DOWN_RX)
    net = pos - neg + 2 * (int(inverse_pos) - int(inverse_neg))

    ordered = sorted(matched, key=lambda t: t["base"], reverse=True)

    return {
        "impact": impact,
        "direction": (net > 0) - (net < 0),
        "tags": [t["tag"] for t in ordered][:2],
    }


def recency_factor(age_hours):
    if age_hours <= 6:
        return 1.0
    return max(0.6, 1.0 - 0.4 * (age_hours - 6) / 18)


def _title_key(title):
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()[:60]


def _parse_pub_date(value):
    try:
        published = email.utils.parsedate_to_datetime(clean_text(value))
    except Exception:
        return None

    if published is None:
        return None

    if published.tzinfo is None:
        published = published.replace(tzinfo=datetime.timezone.utc)

    return published


def parse_rss(content, default_source=""):
    """Parse RSS bytes into raw story dicts. Never raises."""
    try:
        root = ET.fromstring(content)
    except Exception:
        return []

    stories = []

    for item in root.iter("item"):
        title = clean_text(item.findtext("title"))
        published = _parse_pub_date(item.findtext("pubDate"))

        if not title or published is None:
            continue

        source = clean_text(item.findtext("source")) or default_source

        if source and title.endswith(" - " + source):
            title = title[: -(len(source) + 3)].rstrip()

        stories.append({
            "title": title,
            "summary": clean_text(item.findtext("description")),
            "source": source,
            "url": clean_text(item.findtext("link")),
            "published": published,
            "feed": default_source or source,
        })

    return stories


def build_news_digest(stories, now_utc):
    """Score, rank and summarise stories from the last 24 hours."""
    seen = set()
    scored = []

    for story in stories:
        age = (
            now_utc - story["published"].astimezone(datetime.timezone.utc)
        ).total_seconds() / 3600

        if age < -0.5 or age > NEWS_WINDOW_HOURS:
            continue

        key = _title_key(story["title"])
        if not key or key in seen:
            continue
        seen.add(key)

        verdict = classify_news(story["title"], story.get("summary", ""))
        age = max(0.0, age)

        if verdict["impact"] < MIN_RELEVANT_IMPACT:
            continue

        weight = verdict["impact"] * recency_factor(age)

        scored.append({
            "title": story["title"],
            "source": story.get("source", ""),
            "url": story.get("url", ""),
            "score": verdict["direction"],
            "impact": verdict["impact"],
            "tags": verdict["tags"],
            "age": round(age, 2),
            "feed": story.get("feed", ""),
            "published_ist": story["published"].astimezone(IST).isoformat(),
            "_weight": weight,
        })

    scored.sort(key=lambda item: item["_weight"], reverse=True)

    total_weight = sum(item["_weight"] for item in scored)
    net = sum(item["score"] * item["_weight"] for item in scored)
    tone = net / total_weight if total_weight else 0.0
    intensity = min(1.0, total_weight / 25.0)
    score = clamp(1.6 * tone * intensity)

    for item in scored:
        item.pop("_weight")

    return {
        "score": score,
        "items": scored[:MAX_NEWS_ITEMS],
        "top": scored[:TOP_NEWS_COUNT],
        "stats": {
            "relevant": len(scored),
            "positive": sum(1 for i in scored if i["score"] > 0),
            "negative": sum(1 for i in scored if i["score"] < 0),
            "neutral": sum(1 for i in scored if i["score"] == 0),
            "tone": round(tone, 3),
            "intensity": round(intensity, 3),
        },
    }


def fetch_news_digest(now_utc=None):
    """Fetch every feed and return the digest. score is None if nothing loaded."""
    now_utc = now_utc or datetime.datetime.now(datetime.timezone.utc)
    stories = []
    loaded = False

    for feed in RSS_FEEDS:
        try:
            response = requests.get(feed["url"], timeout=20, headers=HEADERS)
            response.raise_for_status()
            parsed = parse_rss(response.content, feed["name"])
            loaded = loaded or bool(parsed)
            stories.extend(parsed)
        except Exception as exc:
            print("News feed error (%s): %s" % (feed["name"], exc))

    for query in GOOGLE_NEWS_QUERIES:
        url = (
            "https://news.google.com/rss/search?q=%s&hl=en-IN&gl=IN&ceid=IN:en"
            % quote_plus(query + " when:1d")
        )
        try:
            response = requests.get(url, timeout=15, headers=HEADERS)
            response.raise_for_status()
            parsed = parse_rss(response.content, "")
            loaded = loaded or bool(parsed)
            stories.extend(parsed[:15])
        except Exception as exc:
            print("News error:", exc)

    digest = build_news_digest(stories, now_utc)

    if not loaded:
        digest["score"] = None

    return digest


# ============================================================
# GAP INPUT FETCHERS
# ============================================================

_GIFT_PRICE_RX = re.compile(
    r"current price of GIFT NIFTY 50 INDEX FUTURES is\s*([\d,]+(?:\.\d+)?)"
)
_GIFT_CHANGE_RX = re.compile(
    r"it has (fallen|risen|gained|lost|dropped|grown|increased|decreased)"
    r"\s*([\u2212\-\u2013+]?)\s*([\d.]+)%"
)


def parse_gift_nifty(text):
    match = _GIFT_PRICE_RX.search(text or "")

    if not match:
        return None

    try:
        price = float(match.group(1).replace(",", ""))
    except ValueError:
        return None

    if price <= 0:
        return None

    change = None
    change_match = _GIFT_CHANGE_RX.search(text)

    if change_match:
        verb, sign, digits = change_match.groups()
        try:
            change = float(digits)
        except ValueError:
            change = None
        if change is not None and (
            verb in ("fallen", "lost", "dropped", "decreased")
            or sign in ("\u2212", "-", "\u2013")
        ):
            change = -abs(change)

    return {"price": price, "change_pct_24h": change}


def fetch_gift_nifty(timeout=15):
    try:
        response = requests.get(GIFT_NIFTY_URL, timeout=timeout, headers=HEADERS)
        response.raise_for_status()
        parsed = parse_gift_nifty(response.text)
    except Exception as exc:
        print("GIFT Nifty error:", exc)
        return None

    if parsed:
        parsed["source"] = "TradingView NSEIX:NIFTY1!"
        parsed["url"] = GIFT_NIFTY_URL

    return parsed


def nse_get(path, timeout=15):
    """GET an NSE JSON endpoint using a cookie session. Returns None on failure."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "Referer": "https://www.nseindia.com/",
    })

    try:
        session.get("https://www.nseindia.com", timeout=timeout)
        response = session.get(
            "https://www.nseindia.com" + path, timeout=timeout
        )
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        print("NSE error (%s): %s" % (path, exc))
        return None


def parse_fii_dii(data):
    if not isinstance(data, list):
        return None

    result = {}

    for row in data:
        category = str(row.get("category", "")).upper()
        try:
            net = float(str(row.get("netValue", "")).replace(",", ""))
        except ValueError:
            continue

        if category.startswith("FII"):
            result["fii_net"] = net
            result["date"] = row.get("date")
        elif category.startswith("DII"):
            result["dii_net"] = net
            result.setdefault("date", row.get("date"))

    return result if "fii_net" in result else None


def fetch_fii_dii():
    return parse_fii_dii(nse_get("/api/fiidiiTradeReact"))


def parse_nifty_snapshot(data):
    rows = (data or {}).get("data") if isinstance(data, dict) else None

    for row in rows or []:
        if row.get("index") == "NIFTY 50":
            try:
                return {
                    "last": float(row["last"]),
                    "open": float(row.get("open") or 0),
                    "prev_close": float(row["previousClose"]),
                }
            except (KeyError, TypeError, ValueError):
                return None

    return None


def fetch_nifty_snapshot():
    return parse_nifty_snapshot(nse_get("/api/allIndices"))


# ============================================================
# GAP OUTLOOK
# ============================================================

def _record_change(records, names):
    return [
        r["change_pct"]
        for r in records or []
        if r.get("name") in names and r.get("change_pct") is not None
    ]


def _avg(values):
    return sum(values) / len(values) if values else None


def _signal(key, name, score, value, detail=""):
    return {
        "key": key,
        "name": name,
        "weight": SIGNAL_WEIGHTS[key],
        "score": score,
        "value": value,
        "detail": detail,
        "available": score is not None,
    }


def _gap_label(score, live):
    if live:
        if score >= 0.5:
            return "BULLISH DRIVERS", "up"
        if score >= 0.2:
            return "MILD BULLISH DRIVERS", "up"
        if score <= -0.5:
            return "BEARISH DRIVERS", "down"
        if score <= -0.2:
            return "MILD BEARISH DRIVERS", "down"
        return "MIXED DRIVERS", "flat"

    if score >= 0.5:
        return "GAP-UP LIKELY", "up"
    if score >= 0.2:
        return "MILD GAP-UP BIAS", "up"
    if score <= -0.5:
        return "GAP-DOWN LIKELY", "down"
    if score <= -0.2:
        return "MILD GAP-DOWN BIAS", "down"
    return "FLAT / MIXED OPEN", "flat"


def build_gap_outlook(
    now,
    market_open,
    nifty_last=None,
    gift=None,
    us_futures=None,
    global_records=None,
    fii_dii=None,
    news=None,
    snapshot=None,
):
    """Combine overnight drivers into one -1..+1 score with alerts.

    us_futures: {"S&P 500 Futures": pct, ...}. news: build_news_digest result.
    snapshot: {"last", "open", "prev_close"} for Nifty from NSE.
    """
    live = bool(market_open)
    signals = []
    alerts = []

    def alert(level, text, direction=None):
        alerts.append({"level": level, "text": text, "direction": direction})

    # GIFT Nifty only means "next gap" when the cash market is shut.
    gift_gap = None
    gift_signal = None

    if gift and nifty_last and not live:
        pct = (gift["price"] / nifty_last - 1) * 100
        if abs(pct) <= 4:
            points = gift["price"] - nifty_last
            gift_gap = {
                "gift_price": gift["price"],
                "nifty_ref": nifty_last,
                "points": points,
                "pct": pct,
                "source": gift.get("source"),
                "url": gift.get("url"),
            }
            gift_signal = _signal(
                "gift", "GIFT Nifty vs Nifty close",
                clamp(pct / 0.8),
                "%+.2f%% (%+.0f pts)" % (pct, points),
                "GIFT %s vs close %s" % (
                    format(gift["price"], ",.1f"),
                    format(nifty_last, ",.1f"),
                ),
            )
            if abs(pct) >= 0.75:
                alert(
                    "critical",
                    "GIFT Nifty indicates a %+.2f%% gap (%+.0f pts)"
                    % (pct, points),
                    "bullish" if pct > 0 else "bearish",
                )
            elif abs(pct) >= 0.4:
                alert(
                    "watch",
                    "GIFT Nifty indicates a %+.2f%% gap" % pct,
                    "bullish" if pct > 0 else "bearish",
                )

    signals.append(
        gift_signal
        or _signal(
            "gift", "GIFT Nifty vs Nifty close", None,
            "n/a",
            "Not used while the market is open" if live
            else "GIFT Nifty unavailable",
        )
    )

    fut_values = [v for v in (us_futures or {}).values() if v is not None]
    fut_avg = _avg(fut_values)
    if fut_avg is not None:
        signals.append(_signal(
            "us_futures", "US index futures", clamp(fut_avg / 1.0),
            "%+.2f%% avg" % fut_avg,
            ", ".join(
                "%s %+.2f%%" % (k, v)
                for k, v in us_futures.items() if v is not None
            ),
        ))
        if abs(fut_avg) >= 1.5:
            alert(
                "critical",
                "US futures moving sharply (%+.2f%%)" % fut_avg,
                "bullish" if fut_avg > 0 else "bearish",
            )
        elif abs(fut_avg) >= 0.8:
            alert(
                "watch",
                "US futures %+.2f%%" % fut_avg,
                "bullish" if fut_avg > 0 else "bearish",
            )
    else:
        signals.append(_signal("us_futures", "US index futures", None, "n/a"))

    asia = _record_change(global_records, ("Nikkei 225", "Hang Seng"))
    asia_avg = _avg(asia)
    signals.append(
        _signal(
            "asia", "Asia (Nikkei, Hang Seng)", clamp(asia_avg / 1.0),
            "%+.2f%% avg" % asia_avg,
        )
        if asia_avg is not None
        else _signal("asia", "Asia (Nikkei, Hang Seng)", None, "n/a")
    )

    vix = _record_change(global_records, ("India VIX",))
    vix_pct = vix[0] if vix else None
    if vix_pct is not None:
        signals.append(_signal(
            "vix", "India VIX", -clamp(vix_pct / 10.0),
            "%+.1f%%" % vix_pct, "Rising VIX is bearish",
        ))
        if vix_pct >= 10:
            alert("critical", "India VIX jumped %+.1f%%" % vix_pct, "bearish")
        elif vix_pct >= 5:
            alert("watch", "India VIX up %+.1f%%" % vix_pct, "bearish")
    else:
        signals.append(_signal("vix", "India VIX", None, "n/a"))

    if fii_dii and fii_dii.get("fii_net") is not None:
        fii = fii_dii["fii_net"]
        dii = fii_dii.get("dii_net") or 0.0
        signals.append(_signal(
            "flows", "FII / DII net flows",
            clamp((fii + 0.5 * dii) / 3000.0),
            "FII %+.0f Cr, DII %+.0f Cr" % (fii, dii),
            "NSE provisional, %s" % (fii_dii.get("date") or "latest"),
        ))
        if abs(fii) >= 3000:
            alert(
                "critical",
                "Heavy FII %s (%+.0f Cr)"
                % ("selling" if fii < 0 else "buying", fii),
                "bearish" if fii < 0 else "bullish",
            )
        elif abs(fii) >= 1500:
            alert(
                "watch",
                "FII net %s %+.0f Cr"
                % ("selling" if fii < 0 else "buying", fii),
                "bearish" if fii < 0 else "bullish",
            )
    else:
        signals.append(_signal("flows", "FII / DII net flows", None, "n/a"))

    risk_map = {
        "Brent Crude": _record_change(global_records, ("Brent Crude",)),
        "USD/INR": _record_change(global_records, ("USD/INR",)),
        "US 10Y Yield": _record_change(global_records, ("US 10Y Yield",)),
        "Dollar Index": _record_change(global_records, ("Dollar Index",)),
    }
    risk_values = [v[0] for v in risk_map.values() if v]
    risk_avg = _avg(risk_values)
    if risk_avg is not None:
        signals.append(_signal(
            "risk", "Crude, rupee, yields, dollar",
            -clamp(risk_avg / 1.5),
            "%+.2f%% avg" % risk_avg,
            ", ".join(
                "%s %+.2f%%" % (k, v[0]) for k, v in risk_map.items() if v
            ) + " (up is bearish)",
        ))
    else:
        signals.append(_signal("risk", "Crude, rupee, yields, dollar", None, "n/a"))

    brent = risk_map["Brent Crude"]
    if brent and abs(brent[0]) >= 3:
        alert(
            "critical",
            "Brent crude moved %+.1f%%" % brent[0],
            "bearish" if brent[0] > 0 else "bullish",
        )
    elif brent and abs(brent[0]) >= 1.5:
        alert(
            "watch",
            "Brent crude %+.1f%%" % brent[0],
            "bearish" if brent[0] > 0 else "bullish",
        )

    inr = risk_map["USD/INR"]
    if inr and abs(inr[0]) >= 0.7:
        alert(
            "watch",
            "Rupee moved sharply (USD/INR %+.2f%%)" % inr[0],
            "bearish" if inr[0] > 0 else "bullish",
        )

    news_score = (news or {}).get("score")
    top = (news or {}).get("top", [])
    if news_score is not None:
        stats = news.get("stats", {})
        signals.append(_signal(
            "news", "News (last 24h)", news_score,
            "%+.2f" % news_score,
            "%d relevant stories: %d bullish, %d bearish" % (
                stats.get("relevant", 0),
                stats.get("positive", 0),
                stats.get("negative", 0),
            ),
        ))
    else:
        signals.append(_signal("news", "News (last 24h)", None, "n/a"))

    for story in top:
        direction = (
            "bullish" if story["score"] > 0
            else "bearish" if story["score"] < 0 else None
        )
        if story["impact"] >= 8:
            alert("critical", "Major news: " + story["title"], direction)
        elif story["impact"] >= 7:
            alert("watch", "Notable news: " + story["title"], direction)

    available = [s for s in signals if s["available"]]
    weight_total = sum(s["weight"] for s in signals)
    weight_avail = sum(s["weight"] for s in available)
    score = (
        sum(s["weight"] * s["score"] for s in available) / weight_avail
        if weight_avail else None
    )
    coverage = weight_avail / weight_total * 100 if weight_total else 0.0

    critical = [a for a in alerts if a["level"] == "critical"]
    watch = [a for a in alerts if a["level"] == "watch"]
    level = "critical" if critical else "watch" if watch else "none"

    potential_move = None
    if critical:
        bull = sum(1 for a in critical if a["direction"] == "bullish")
        bear = sum(1 for a in critical if a["direction"] == "bearish")
        if bear > bull:
            move, text = "down", "Potential sharp DOWN move risk"
        elif bull > bear:
            move, text = "up", "Potential sharp UP move risk"
        else:
            move, text = "two-way", "Potential sharp two-way volatility"
        potential_move = {
            "direction": move,
            "text": "%s: %s" % (
                text,
                "; ".join(a["text"][:90] for a in critical[:2]),
            ),
        }

    label, direction = (
        _gap_label(score, live) if score is not None else ("UNAVAILABLE", "flat")
    )

    opening_gap = None
    if live and snapshot and snapshot.get("open") and snapshot.get("prev_close"):
        opening_gap = {
            "open": snapshot["open"],
            "prev_close": snapshot["prev_close"],
            "pct": (snapshot["open"] / snapshot["prev_close"] - 1) * 100,
        }

    return {
        "mode": "live" if live else "pre_open",
        "title": (
            "Overnight drivers & opening gap" if live
            else "Next-session gap outlook"
        ),
        "label": label,
        "direction": direction,
        "score": score,
        "coverage_pct": coverage,
        "indicated_gap": gift_gap,
        "opening_gap": opening_gap,
        "signals": signals,
        "alerts": alerts,
        "alert_level": level,
        "potential_move": potential_move,
        "top_news": top,
        "news_stats": (news or {}).get("stats"),
        "generated_at": now.isoformat(),
        "overall_weight": overall_weight(level),
    }


def overall_weight(alert_level):
    """Weight of the gap outlook inside the overall market score."""
    return {"critical": 14, "watch": 10}.get(alert_level, 8)


# ============================================================
# TELEGRAM TEXT
# ============================================================

def _md(text):
    return re.sub(r"[*_`\[\]]", "", str(text or ""))


def render_gap_outlook_lines(outlook):
    if not outlook:
        return []

    icon = {"up": "🟢", "down": "🔴"}.get(outlook["direction"], "⚖️")
    score = outlook.get("score")

    lines = [
        "🌅 *%s*" % _md(outlook["title"].upper()),
        "%s *%s*%s" % (
            icon,
            _md(outlook["label"]),
            "" if score is None else " (score %+.0f/100)" % (score * 100),
        ),
    ]

    gap = outlook.get("indicated_gap")
    if gap:
        lines.append(
            "  • GIFT Nifty %s vs close %s: *%+.0f pts (%+.2f%%)*" % (
                format(gap["gift_price"], ",.1f"),
                format(gap["nifty_ref"], ",.1f"),
                gap["points"], gap["pct"],
            )
        )

    opening = outlook.get("opening_gap")
    if opening:
        lines.append(
            "  • Today's open %s vs prev close %s: %+.2f%%" % (
                format(opening["open"], ",.1f"),
                format(opening["prev_close"], ",.1f"),
                opening["pct"],
            )
        )

    for sig in outlook["signals"]:
        if sig["available"]:
            lines.append("  • %s: %s" % (_md(sig["name"]), _md(sig["value"])))

    move = outlook.get("potential_move")
    if move:
        lines.append("🚨 *%s*" % _md(move["text"])[:300])
    elif outlook["alert_level"] == "watch":
        lines.append(
            "⚠️ Watch: " + _md("; ".join(a["text"] for a in outlook["alerts"][:2]))[:250]
        )

    top = outlook.get("top_news") or []
    if top:
        lines.append("*Top news (24h, by market impact)*")
        for story in top:
            mark = (
                "🟢" if story["score"] > 0
                else "🔴" if story["score"] < 0 else "⚪"
            )
            lines.append(
                "  %s [%.0f/10] %s _(%s)_" % (
                    mark, story["impact"],
                    _md(story["title"])[:110], _md(story["source"]),
                )
            )

    lines.append("")
    return lines
