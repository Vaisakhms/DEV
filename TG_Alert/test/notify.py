"""Live Nifty market bias report -> Telegram.

Fully automatic Fyers login (TOTP), so no daily auth code is needed.
"""
import base64
import datetime
import email.utils
import os
import re
import time
import xml.etree.ElementTree as ET
from urllib.parse import parse_qs, quote_plus, urlparse
from zoneinfo import ZoneInfo

import pandas as pd
import pyotp
import requests
import yfinance as yf
from fyers_apiv3 import fyersModel

IST = ZoneInfo("Asia/Kolkata")

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
FYERS_CLIENT_ID = os.getenv("FYERS_CLIENT_ID")  # e.g. ABCD1234EF-100
FYERS_SECRET_KEY = os.getenv("FYERS_SECRET_KEY")
FYERS_ID = os.getenv("FYERS_ID")  # your login id, e.g. XA12345
FYERS_PIN = os.getenv("FYERS_PIN")
FYERS_TOTP_SECRET = os.getenv("FYERS_TOTP_SECRET")
FYERS_AUTH_CODE = os.getenv("FYERS_AUTH_CODE")  # optional one-time fallback
REDIRECT_URI = os.getenv(
    "FYERS_REDIRECT_URI",
    "https://trade.fyers.in/api-login/redirect-uri/index.html",
)

WEIGHTS_NOTE = "Rule-based indicators, not investment advice."


# ----------------------------------------------------------------- helpers
def clamp(x, lo=-1.0, hi=1.0):
  return max(lo, min(hi, x))


def b64(text):
  return base64.b64encode(str(text).encode()).decode()


def safe_md(text):
  return re.sub(r"[*_`\[\]]", "", text or "")


def lakh(n):
  return "%s%.1fL" % ("-" if n < 0 else "", abs(n) / 1e5)


def label_from_score(s):
  if s >= 0.6:
    return "Bullish 🟢"
  if s <= -0.6:
    return "Bearish 🔴"
  return "Neutral ⚖️"


def overall_label(total):
  if total >= 40:
    return "STRONG BULLISH 🟢🟢"
  if total >= 15:
    return "BULLISH 🟢"
  if total > -15:
    return "NEUTRAL / SIDEWAYS ⚖️"
  if total > -40:
    return "BEARISH 🔴"
  return "STRONG BEARISH 🔴🔴"


def market_status(now):
  if now.weekday() >= 5:
    return "CLOSED (weekend)"
  if datetime.time(9, 15) <= now.time() <= datetime.time(15, 30):
    return "OPEN"
  return "CLOSED (data = last session)"


# ------------------------------------------------------------ Telegram I/O
def send_telegram_message(message):
  url = "https://api.telegram.org/bot%s/sendMessage" % TELEGRAM_BOT_TOKEN
  chunks, current = [], ""
  for line in message.split("\n"):
    if len(current) + len(line) + 1 > 3800:
      chunks.append(current)
      current = ""
    current += line + "\n"
  if current.strip():
    chunks.append(current)

  for chunk in chunks:
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": chunk,
        "parse_mode": "Markdown",
    }
    resp = requests.post(url, json=payload, timeout=20)
    if resp.status_code != 200:
      print("Markdown send failed (%s), retrying as plain text" % resp.text)
      payload["parse_mode"] = None
      payload.pop("parse_mode")
      payload["text"] = chunk.replace("*", "").replace("`", "")
      resp = requests.post(url, json=payload, timeout=20)
    print("Telegram chunk status:", resp.status_code)


# ------------------------------------------------------------- Fyers login
def _post(url, **kwargs):
  resp = requests.post(url, timeout=20, **kwargs)
  try:
    body = resp.json()
  except ValueError:
    body = {}
  return resp.status_code, body


def _fail(step, status, body):
  msg = body.get("message") or body.get("s") or ""
  raise RuntimeError(
      "Fyers login failed at %s (HTTP %s) %s" % (step, status, msg)
  )


def fyers_auto_login():
  """Fyers ID + PIN + TOTP -> auth_code (unofficial but widely used flow)."""
  base = "https://api-t2.fyers.in/vagator/v2"

  status, body = _post(
      base + "/send_login_otp_v2",
      json={"fy_id": b64(FYERS_ID), "app_id": "2"},
  )
  if status != 200 or "request_key" not in body:
    _fail("send_login_otp", status, body)
  request_key = body["request_key"]

  # avoid submitting a code that is about to expire
  if 30 - (int(time.time()) % 30) < 4:
    time.sleep(5)
  status, body = _post(
      base + "/verify_otp",
      json={
          "request_key": request_key,
          "otp": pyotp.TOTP(FYERS_TOTP_SECRET).now(),
      },
  )
  if status != 200 or "request_key" not in body:
    _fail("verify_totp (check TOTP secret)", status, body)
  request_key = body["request_key"]

  status, body = _post(
      base + "/verify_pin_v2",
      json={
          "request_key": request_key,
          "identity_type": "pin",
          "identifier": b64(FYERS_PIN),
      },
  )
  bearer = (body.get("data") or {}).get("access_token")
  if status != 200 or not bearer:
    _fail("verify_pin (check PIN)", status, body)

  status, body = _post(
      "https://api-t1.fyers.in/api/v3/token",
      headers={
          "Authorization": "Bearer " + bearer,
          "Content-Type": "application/json",
      },
      json={
          "fyers_id": FYERS_ID,
          "app_id": FYERS_CLIENT_ID.split("-")[0],
          "redirect_uri": REDIRECT_URI,
          "appType": "100",
          "code_challenge": "",
          "state": "None",
          "scope": "",
          "nonce": "",
          "response_type": "code",
          "create_cookie": True,
      },
  )
  codes = parse_qs(urlparse(body.get("Url") or "").query).get("auth_code")
  if not codes:
    _fail("get_auth_code (check Client ID / redirect URI)", status, body)
  return codes[0]


_fyers = None
_fyers_error = None


def get_fyers_client():
  """Builds the Fyers client once per run; remembers failures."""
  global _fyers, _fyers_error
  if _fyers:
    return _fyers
  if _fyers_error:
    return None
  try:
    if not FYERS_CLIENT_ID or not FYERS_SECRET_KEY:
      raise RuntimeError("FYERS_CLIENT_ID / FYERS_SECRET_KEY missing")
    if FYERS_ID and FYERS_PIN and FYERS_TOTP_SECRET:
      auth_code = fyers_auto_login()
    elif FYERS_AUTH_CODE:
      auth_code = FYERS_AUTH_CODE
    else:
      raise RuntimeError("No Fyers login secrets configured")

    session = fyersModel.SessionModel(
        client_id=FYERS_CLIENT_ID,
        secret_key=FYERS_SECRET_KEY,
        redirect_uri=REDIRECT_URI,
        response_type="code",
        grant_type="authorization_code",
    )
    session.set_token(auth_code)
    resp = session.generate_token()
    token = resp.get("access_token")
    if not token:
      raise RuntimeError(
          "Token exchange failed: %s" % (resp.get("message") or resp.get("s"))
      )
    _fyers = fyersModel.FyersModel(
        client_id=FYERS_CLIENT_ID, token=token, log_path=""
    )
    print("Fyers login OK")
    return _fyers
  except Exception as e:
    _fyers_error = str(e)
    print("Fyers error:", _fyers_error)
    return None


# ------------------------------------------------------------ Market data
def fetch_history(symbol, resolution, days):
  fyers = get_fyers_client()
  if not fyers:
    return pd.DataFrame()
  now = datetime.datetime.now(IST)
  data = {
      "symbol": symbol,
      "resolution": resolution,
      "date_format": "0",
      "range_from": str(int((now - datetime.timedelta(days=days)).timestamp())),
      "range_to": str(int(now.timestamp())),
      "cont_flag": "1",
  }
  try:
    resp = fyers.history(data=data)
  except Exception as e:
    print("history error %s [%s]: %s" % (symbol, resolution, e))
    return pd.DataFrame()
  if resp.get("s") == "ok" and resp.get("candles"):
    df = pd.DataFrame(
        resp["candles"],
        columns=["Epoch", "Open", "High", "Low", "Close", "Volume"],
    )
    df["Datetime"] = pd.to_datetime(df["Epoch"], unit="s", utc=True).dt.tz_convert(IST)
    return df.set_index("Datetime")
  print("history failed %s [%s]: %s" % (symbol, resolution, resp.get("message") or resp))
  return pd.DataFrame()


def compute_rsi(series, period=14):
  delta = series.diff()
  gain = delta.where(delta > 0, 0.0)
  loss = -delta.where(delta < 0, 0.0)
  avg_gain = gain.ewm(alpha=1 / period, min_periods=period).mean()
  avg_loss = loss.ewm(alpha=1 / period, min_periods=period).mean()
  rs = avg_gain / avg_loss
  return 100 - (100 / (1 + rs))


def analyze_series(df):
  """SMA 20/50/100 + RSI + trend score (-1..+1) for one timeframe."""
  if df is None or df.empty or len(df) < 21:
    return None
  c = df["Close"].astype(float)
  last, prev = float(c.iloc[-1]), float(c.iloc[-2])
  sma = {}
  for n in (20, 50, 100):
    sma[n] = float(c.rolling(n).mean().iloc[-1]) if len(c) >= n else None

  pts = maxpts = 0
  for n in (20, 50, 100):
    if sma[n] is not None:
      maxpts += 1
      pts += int(last > sma[n])
  for a, b in ((20, 50), (50, 100)):
    if sma[a] is not None and sma[b] is not None:
      maxpts += 1
      pts += int(sma[a] > sma[b])
  score = (pts / maxpts) * 2 - 1 if maxpts else 0.0

  return {
      "close": last,
      "chg": (last / prev - 1) * 100,
      "sma": sma,
      "rsi": float(compute_rsi(c).iloc[-1]),
      "score": score,
      "label": label_from_score(score),
  }


def tf_line(label, a):
  if not a:
    return "  • *%s*: data unavailable" % label

  def m(n):
    v = a["sma"][n]
    if v is None:
      return "n/a"
    return "%s%s" % (format(v, ",.0f"), "▲" if a["close"] > v else "▼")

  return "  • *%s*: %s (%+.2f%%) | SMA20 %s 50 %s 100 %s | RSI %.0f | %s" % (
      label, format(a["close"], ",.1f"), a["chg"], m(20), m(50), m(100),
      a["rsi"], a["label"],
  )


def seven_day(df):
  """Last 7 sessions: net move, up days, range position, momentum score."""
  if df is None or df.empty or len(df) < 8:
    return None
  d = df.tail(8)
  closes = d["Close"].astype(float).values
  chg = [(closes[i] / closes[i - 1] - 1) * 100 for i in range(1, 8)]
  net = (closes[-1] / closes[0] - 1) * 100
  hi = float(d["High"].iloc[1:].max())
  lo = float(d["Low"].iloc[1:].min())
  pos = (closes[-1] - lo) / (hi - lo) * 100 if hi > lo else 50.0
  up = sum(1 for x in chg if x > 0)
  score = clamp(0.5 * clamp(net / 2.0) + 0.5 * ((up / 7.0) * 2 - 1))
  return {
      "net": net, "up": up, "hi": hi, "lo": lo, "pos": pos,
      "chg": chg, "score": score,
  }


def pivots_from_daily(df):
  if df is None or df.empty or len(df) < 2:
    return None
  today = datetime.datetime.now(IST).date()
  done = df[df.index.date < today]
  row = done.iloc[-1] if not done.empty else df.iloc[-2]
  h, l, c = float(row["High"]), float(row["Low"]), float(row["Close"])
  p = (h + l + c) / 3
  return {
      "R2": p + (h - l), "R1": 2 * p - l, "P": p,
      "S1": 2 * p - h, "S2": p - (h - l),
  }


# ----------------------------------------------------------- Options / OI
def classify_buildup(ltp_change, oi_change):
  if oi_change > 0 and ltp_change >= 0:
    return "Long buildup"
  if oi_change > 0 and ltp_change < 0:
    return "Short buildup"
  if oi_change < 0 and ltp_change >= 0:
    return "Short covering"
  if oi_change < 0 and ltp_change < 0:
    return "Long unwinding"
  return "No change"


BUILDUP_VALUE = {
    "CE": {"Long buildup": 1.0, "Short covering": 0.5, "Short buildup": -1.0,
           "Long unwinding": -0.5, "No change": 0.0},
    "PE": {"Long buildup": -1.0, "Short covering": -0.5, "Short buildup": 1.0,
           "Long unwinding": 0.5, "No change": 0.0},
}


def pcr_to_score(pcr):
  if pcr >= 1.2:
    return 1.0
  if pcr >= 1.0:
    return 0.5
  if pcr >= 0.8:
    return 0.0
  if pcr >= 0.6:
    return -0.5
  return -1.0


def fetch_fyers_options(spot_hint):
  fyers = get_fyers_client()
  if not fyers:
    return None
  try:
    resp = fyers.optionchain(
        data={"symbol": "NSE:NIFTY50-INDEX", "strikecount": 12, "timestamp": ""}
    )
  except Exception as e:
    print("optionchain error:", e)
    return None
  if resp.get("s") != "ok":
    print("optionchain failed:", resp.get("message") or resp)
    return None

  d = resp.get("data", {})
  chain = d.get("optionsChain", [])
  spot = None
  for x in chain:
    if not x.get("option_type"):
      spot = x.get("ltp")
      break
  spot = float(spot or spot_hint or 0)

  strikes = {}
  for x in chain:
    ot = x.get("option_type")
    sp = x.get("strike_price")
    if ot in ("CE", "PE") and sp not in (None, -1):
      strikes.setdefault(float(sp), {})[ot] = x
  if not strikes or not spot:
    return None

  def g(item, key):
    return float(item.get(key) or 0)

  atm = min(strikes, key=lambda s: abs(s - spot))
  ce, pe = strikes[atm].get("CE", {}), strikes[atm].get("PE", {})
  zone = [s for s in strikes if abs(s - atm) <= 250]

  zone_ce_chg = sum(g(strikes[s].get("CE", {}), "oich") for s in zone)
  zone_pe_chg = sum(g(strikes[s].get("PE", {}), "oich") for s in zone)
  zone_ce_oi = sum(g(strikes[s].get("CE", {}), "oi") for s in zone)
  zone_pe_oi = sum(g(strikes[s].get("PE", {}), "oi") for s in zone)

  all_ce = sum(g(v.get("CE", {}), "oi") for v in strikes.values())
  all_pe = sum(g(v.get("PE", {}), "oi") for v in strikes.values())
  tot_ce = float(d.get("callOi") or all_ce)
  tot_pe = float(d.get("putOi") or all_pe)
  pcr = tot_pe / tot_ce if tot_ce > 0 else 0.0
  zone_pcr = zone_pe_oi / zone_ce_oi if zone_ce_oi > 0 else 0.0

  resistance = max(strikes, key=lambda s: g(strikes[s].get("CE", {}), "oi"))
  support = max(strikes, key=lambda s: g(strikes[s].get("PE", {}), "oi"))

  ce_b = classify_buildup(g(ce, "ltpch"), g(ce, "oich"))
  pe_b = classify_buildup(g(pe, "ltpch"), g(pe, "oich"))
  buildup_score = (BUILDUP_VALUE["CE"][ce_b] + BUILDUP_VALUE["PE"][pe_b]) / 2
  denom = abs(zone_pe_chg) + abs(zone_ce_chg)
  flow_score = clamp((zone_pe_chg - zone_ce_chg) / denom) if denom else 0.0

  expiry = ""
  ed = d.get("expiryData")
  if isinstance(ed, list) and ed:
    expiry = str(ed[0].get("date") or ed[0].get("expiry") or "")

  straddle = g(ce, "ltp") + g(pe, "ltp")
  return {
      "source": "Fyers", "expiry": expiry, "spot": spot, "atm": atm,
      "ce": ce, "pe": pe, "ce_b": ce_b, "pe_b": pe_b,
      "straddle": straddle,
      "move_pct": straddle / spot * 100 if spot else 0.0,
      "pcr": pcr, "zone_pcr": zone_pcr,
      "zone_ce_chg": zone_ce_chg, "zone_pe_chg": zone_pe_chg,
      "resistance": resistance, "support": support,
      "pcr_score": pcr_to_score(pcr),
      "oi_score": clamp(0.5 * flow_score + 0.5 * buildup_score),
  }


def fetch_nse_fallback():
  """PCR / max OI only. NSE frequently blocks cloud IPs."""
  headers = {
      "User-Agent": (
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML,"
          " like Gecko) Chrome/120.0.0.0 Safari/537.36"
      ),
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.nseindia.com/option-chain",
  }
  try:
    s = requests.Session()
    s.get("https://www.nseindia.com", headers=headers, timeout=10)
    r = s.get(
        "https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY",
        headers=headers, timeout=10,
    )
    if r.status_code != 200:
      print("NSE returned", r.status_code)
      return None
    data = r.json()
    expiry = data["records"]["expiryDates"][0]
    tot_ce = tot_pe = max_ce = max_pe = 0
    res = sup = 0
    for item in data["records"]["data"]:
      if item.get("expiryDate") != expiry:
        continue
      st = item.get("strikePrice")
      if "CE" in item:
        oi = item["CE"].get("openInterest", 0)
        tot_ce += oi
        if oi > max_ce:
          max_ce, res = oi, st
      if "PE" in item:
        oi = item["PE"].get("openInterest", 0)
        tot_pe += oi
        if oi > max_pe:
          max_pe, sup = oi, st
    pcr = tot_pe / tot_ce if tot_ce else 0.0
    return {
        "source": "NSE", "expiry": expiry, "pcr": pcr,
        "resistance": res, "support": sup,
        "pcr_score": pcr_to_score(pcr), "oi_score": None,
    }
  except Exception as e:
    print("NSE fallback error:", e)
    return None


def render_options(o):
  if not o:
    return ["  Option data unavailable (Fyers and NSE both failed)"]
  lines = []
  if o["source"] == "Fyers":
    ce, pe = o["ce"], o["pe"]

    def leg(name, item, tag):
      return "  • *ATM %s %d*: ₹%.1f (%+.1f) | OI %s (Δ %s) → %s" % (
          name, o["atm"], float(item.get("ltp") or 0),
          float(item.get("ltpch") or 0), lakh(float(item.get("oi") or 0)),
          lakh(float(item.get("oich") or 0)), tag,
      )

    lines.append("  • *Expiry*: %s | *Spot*: %s | *ATM*: %d" % (
        o["expiry"] or "nearest", format(o["spot"], ",.1f"), o["atm"]))
    lines.append(leg("CE", ce, o["ce_b"]))
    lines.append(leg("PE", pe, o["pe_b"]))
    lines.append("  • *Straddle premium*: ₹%.1f (market implies ±%.2f%% move)" % (
        o["straddle"], o["move_pct"]))
    lines.append("  • *OI change near ATM (±5 strikes)*: Calls %s vs Puts %s" % (
        lakh(o["zone_ce_chg"]), lakh(o["zone_pe_chg"])))
    lines.append("  • *PCR live*: %.2f total | %.2f near ATM" % (
        o["pcr"], o["zone_pcr"]))
  else:
    lines.append("  • *Expiry*: %s (NSE fallback, no ATM premium data)" % o["expiry"])
    lines.append("  • *PCR live*: %.2f" % o["pcr"])
  lines.append("  • *Resistance (max Call OI)*: %s | *Support (max Put OI)*: %s" % (
      format(o["resistance"], ",.0f"), format(o["support"], ",.0f")))
  return lines


# ----------------------------------------------------------- World markets
EQUITY_TICKERS = [
    ("Dow Jones", "^DJI"), ("S&P 500", "^GSPC"), ("Nasdaq", "^IXIC"),
    ("Nikkei 225", "^N225"), ("Hang Seng", "^HSI"),
    ("FTSE 100", "^FTSE"), ("DAX", "^GDAXI"),
]
RISK_TICKERS = [
    ("Brent Crude", "BZ=F"), ("Dollar Index", "DX-Y.NYB"),
    ("USD/INR", "INR=X"), ("US 10Y Yield", "^TNX"), ("India VIX", "^INDIAVIX"),
]


def yf_change(ticker):
  try:
    closes = yf.Ticker(ticker).history(period="10d")["Close"].dropna()
    if len(closes) >= 2:
      cur, prev = float(closes.iloc[-1]), float(closes.iloc[-2])
      return cur, (cur / prev - 1) * 100
  except Exception as e:
    print("yfinance error %s: %s" % (ticker, e))
  return None, None


def global_analysis():
  lines, eq, risk = [], [], []
  lines.append("*Equities*")
  for name, tk in EQUITY_TICKERS:
    price, pct = yf_change(tk)
    if pct is None:
      lines.append("  • %s: unavailable" % name)
    else:
      eq.append(pct)
      lines.append("  • %s: %s (%+.2f%%)" % (name, format(price, ",.2f"), pct))
  lines.append("*Risk gauges* (up = negative for India)")
  for name, tk in RISK_TICKERS:
    price, pct = yf_change(tk)
    if pct is None:
      lines.append("  • %s: unavailable" % name)
    else:
      risk.append(pct)
      lines.append("  • %s: %s (%+.2f%%)" % (name, format(price, ",.2f"), pct))

  score = None
  if eq or risk:
    eq_s = clamp((sum(eq) / len(eq)) / 1.0) if eq else 0.0
    rk_s = -clamp((sum(risk) / len(risk)) / 1.5) if risk else 0.0
    score = 0.75 * eq_s + 0.25 * rk_s
  return lines, score


# --------------------------------------------------------------------- News
NEWS_QUERIES = [
    'Nifty OR Sensex OR "Indian stock market"',
    'RBI OR "Federal Reserve" OR inflation OR "interest rate"',
    '"crude oil" OR war OR tariff OR sanctions stocks',
    'FII OR FPI OR "foreign investors" India',
]
POS_WORDS = [
    "rally", "rallies", "surge", "surges", "gain", "gains", "jumps", "soars",
    "record high", "rate cut", "cools", "eases", "inflow", "inflows",
    "upgrade", "beats", "rebound", "rebounds", "recovers", "optimism",
    "ceasefire", "bullish",
]
NEG_WORDS = [
    "fall", "falls", "plunge", "plunges", "crash", "slump", "slumps",
    "selloff", "sell-off", "drops", "slides", "tumbles", "rate hike",
    "outflow", "outflows", "selling", "downgrade", "fears", "recession",
    "war", "tariff", "tariffs", "sanctions", "attack", "misses", "losses",
    "warning", "bearish",
]
CONCERN_WORDS = [
    "RBI", "Fed", "Federal Reserve", "war", "tariff", "tariffs", "sanctions",
    "ceasefire", "election", "budget", "GDP", "CPI", "inflation", "crude",
    "OPEC", "FII", "FPI", "default", "rate cut", "rate hike",
]


def _count(words, text):
  return sum(
      1 for w in words if re.search(r"\b" + re.escape(w) + r"\b", text)
  )


def fetch_news():
  items, seen = [], set()
  now_utc = datetime.datetime.now(datetime.timezone.utc)
  for q in NEWS_QUERIES:
    url = (
        "https://news.google.com/rss/search?q=%s&hl=en-IN&gl=IN&ceid=IN:en"
        % quote_plus(q + " when:1d")
    )
    try:
      r = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
      root = ET.fromstring(r.content)
    except Exception as e:
      print("news error:", e)
      continue
    for it in list(root.iter("item"))[:8]:
      title = safe_md(it.findtext("title"))
      key = title.lower()[:60]
      if not title or key in seen:
        continue
      seen.add(key)
      try:
        pub = email.utils.parsedate_to_datetime(it.findtext("pubDate"))
        age_h = (now_utc - pub).total_seconds() / 3600
      except Exception:
        age_h = 24
      if age_h > 30:
        continue
      low = title.lower()
      s = _count(POS_WORDS, low) - _count(NEG_WORDS, low)
      tags = [w for w in CONCERN_WORDS
              if re.search(r"\b" + re.escape(w) + r"\b", title, re.I)]
      items.append({
          "title": title, "source": safe_md(it.findtext("source") or ""),
          "score": (s > 0) - (s < 0), "tags": tags[:2], "age": age_h,
      })
  scored = [i["score"] for i in items if i["score"] != 0]
  score = clamp(1.5 * sum(scored) / len(scored)) if scored else 0.0
  items.sort(key=lambda i: (not (i["score"] or i["tags"]), i["age"]))
  return items[:7], (score if items else None)


def render_news(items):
  if not items:
    return ["  No recent headlines retrieved"]
  out = []
  for i in items:
    icon = "🟢" if i["score"] > 0 else "🔴" if i["score"] < 0 else "⚪"
    tag = " [%s]" % ", ".join(i["tags"]) if i["tags"] else ""
    out.append("  %s %s%s _(%s)_" % (icon, i["title"][:110], tag, i["source"]))
  out.append("  _Headline bias = keyword-based, treat as a rough guide_")
  return out


# ------------------------------------------------------------------- Main
def main():
  now = datetime.datetime.now(IST)
  indices = {
      "Nifty 50": "NSE:NIFTY50-INDEX",
      "Bank Nifty": "NSE:NIFTYBANK-INDEX",
      "Nifty Midcap": "NSE:NIFTYMIDCAP50-INDEX",
  }
  timeframes = [("15m", "15", 25), ("30m", "30", 35), ("1h", "60", 60),
                ("Daily", "D", 250)]

  analysis, daily_df = {}, {}
  for name, symbol in indices.items():
    analysis[name] = {}
    for label, res, days in timeframes:
      df = fetch_history(symbol, res, days)
      if label == "Daily":
        daily_df[name] = df
      analysis[name][label] = analyze_series(df)
      time.sleep(0.15)

  nifty, bank = analysis["Nifty 50"], analysis["Bank Nifty"]
  seven = {n: seven_day(daily_df[n]) for n in indices}
  piv = pivots_from_daily(daily_df["Nifty 50"])

  spot_hint = nifty["15m"]["close"] if nifty["15m"] else None
  opt = fetch_fyers_options(spot_hint) or fetch_nse_fallback()
  global_lines, global_score = global_analysis()
  news_items, news_score = fetch_news()

  def sc(a):
    return a["score"] if a else None

  bank_scores = [a["score"] for a in bank.values() if a]
  comps = [
      ("Nifty daily SMA trend", 15, sc(nifty["Daily"])),
      ("Nifty 7-day momentum", 10, seven["Nifty 50"]["score"] if seven["Nifty 50"] else None),
      ("Nifty 15m trend", 8, sc(nifty["15m"])),
      ("Nifty 30m trend", 8, sc(nifty["30m"])),
      ("Nifty 1h trend", 9, sc(nifty["1h"])),
      ("Bank Nifty confirmation", 10, sum(bank_scores) / len(bank_scores) if bank_scores else None),
      ("PCR", 10, opt["pcr_score"] if opt else None),
      ("ATM OI flow & buildup", 10, opt["oi_score"] if opt else None),
      ("Global markets", 10, global_score),
      ("News sentiment", 10, news_score),
  ]
  avail = [(n, w, s) for n, w, s in comps if s is not None]
  wsum = sum(w for _, w, _ in avail)
  total = sum(w * s for _, w, s in avail) / wsum * 100 if wsum else 0.0

  # ---------------- render ----------------
  L = []
  L.append("🧭 *LIVE MARKET BIAS*")
  L.append("_%s IST • NSE: %s_" % (now.strftime("%Y-%m-%d %H:%M"), market_status(now)))
  L.append("*Overall: %s (score %+.0f/100)*" % (overall_label(total), total))
  L.append("_Signal coverage: %.0f%% of weight available_" % wsum)
  if _fyers_error:
    L.append("⚠️ *Fyers unavailable*: `%s`" % safe_md(_fyers_error)[:200])
  ranked = sorted(avail, key=lambda x: x[1] * x[2], reverse=True)
  bulls = [n for n, w, s in ranked if s > 0.2][:2]
  bears = [n for n, w, s in reversed(ranked) if s < -0.2][:2]
  if bulls:
    L.append("🟢 Supporting: " + ", ".join(bulls))
  if bears:
    L.append("🔴 Pressuring: " + ", ".join(bears))

  L.append("\n*Score breakdown* (contribution/weight)")
  for n, w, s in comps:
    if s is None:
      L.append("  • %s: n/a" % n)
    else:
      L.append("  • %s: %+.1f/%d" % (n, w * s, w))

  L.append("\n*1. Key levels (Nifty 50)*")
  if piv:
    L.append("  • Pivots: R2 %s | R1 %s | P %s | S1 %s | S2 %s" % tuple(
        format(piv[k], ",.0f") for k in ("R2", "R1", "P", "S1", "S2")))
  if opt:
    L.append("  • OI wall: Resistance %s | Support %s" % (
        format(opt["resistance"], ",.0f"), format(opt["support"], ",.0f")))
  if not piv and not opt:
    L.append("  • unavailable")

  L.append("\n*2. Last 7 sessions*")
  for n in ("Nifty 50", "Bank Nifty", "Nifty Midcap"):
    s = seven[n]
    if not s:
      L.append("  • *%s*: data unavailable" % n)
      continue
    L.append("  • *%s*: net %+.2f%% | up days %d/7 | range %s–%s | at %.0f%% of range" % (
        n, s["net"], s["up"], format(s["lo"], ",.0f"), format(s["hi"], ",.0f"), s["pos"]))
    L.append("    Daily %%: %s" % " ".join("%+.1f" % x for x in s["chg"]))

  L.append("\n*3. Trend by timeframe* (▲ above SMA, ▼ below)")
  for n in indices:
    L.append("*%s*" % n)
    for label, _, _ in timeframes:
      L.append(tf_line(label if label == "Daily" else label, analysis[n][label]))

  L.append("\n*4. Options: ATM premium, OI & PCR (Nifty)*")
  L.extend(render_options(opt))

  L.append("\n*5. World markets*")
  L.extend(global_lines)

  L.append("\n*6. News to watch*")
  L.extend(render_news(news_items))

  L.append("\n_%s_" % WEIGHTS_NOTE)
  send_telegram_message("\n".join(L))


if __name__ == "__main__":
  main()