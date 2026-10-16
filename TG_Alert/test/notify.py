import datetime
import os
import numpy as np
import pandas as pd
import requests
from fyers_apiv3 import fyersModel
import yfinance as yf

# Load credentials from GitHub Secrets
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
FYERS_CLIENT_ID = os.getenv("FYERS_CLIENT_ID")
FYERS_SECRET_KEY = os.getenv("FYERS_SECRET_KEY")
FYERS_AUTH_CODE = os.getenv("FYERS_AUTH_CODE")
REDIRECT_URI = "https://trade.fyers.in/api-login/redirect-uri/index.html"


def get_fyers_client():
  """Automatically exchanges the Auth Code for an Access Token and returns the Fyers client."""
  if not FYERS_CLIENT_ID or not FYERS_SECRET_KEY or not FYERS_AUTH_CODE:
    print("Fyers credentials or Auth Code missing.")
    return None

  try:
    session = fyersModel.SessionModel(
        client_id=FYERS_CLIENT_ID,
        secret_key=FYERS_SECRET_KEY,
        redirect_uri=REDIRECT_URI,
        response_type="code",
        grant_type="authorization_code",
    )
    session.set_token(FYERS_AUTH_CODE)
    response = session.generate_token()

    if "access_token" in response:
      access_token = response["access_token"]
      return fyersModel.FyersModel(
          client_id=FYERS_CLIENT_ID, token=access_token, log_path=""
      )
    else:
      print(f"Failed to generate access token: {response}")
      return None
  except Exception as e:
    print(f"Error during token generation: {e}")
    return None


def send_telegram_message(message):
  url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
  payload = {
      "chat_id": TELEGRAM_CHAT_ID,
      "text": message,
      "parse_mode": "Markdown",
  }
  response = requests.post(url, json=payload)
  if response.status_code == 200:
    print("Notification sent successfully!")
  else:
    print(f"Failed to send notification: {response.text}")


def compute_rsi(series, period=14):
  delta = series.diff()
  gain = delta.where(delta > 0, 0.0)
  loss = -delta.where(delta < 0, 0.0)
  avg_gain = gain.ewm(alpha=1 / period, min_periods=period).mean()
  avg_loss = loss.ewm(alpha=1 / period, min_periods=period).mean()
  rs = avg_gain / avg_loss
  return 100 - (100 / (1 + rs))


def fetch_fyers_history(symbol, resolution, range_from, range_to):
  """Fetches historical OHLC data from Fyers API v3."""
  fyers = get_fyers_client()
  if not fyers:
    return pd.DataFrame()

  data = {
      "symbol": symbol,
      "resolution": resolution,
      "date_format": "1",
      "range_from": range_from,
      "range_to": range_to,
      "cont_flag": "1",
  }

  response = fyers.history(data=data)
  if response.get("s") == "success":
    candles = response.get("candles", [])
    df = pd.DataFrame(
        candles, columns=["Epoch", "Open", "High", "Low", "Close", "Volume"]
    )
    df["Datetime"] = pd.to_datetime(df["Epoch"], unit="s")
    df.set_index("Datetime", inplace=True)
    return df
  return pd.DataFrame()


def fetch_nse_option_chain():
  """Fetches live Open Interest (PCR, Max Call/Put OI) from NSE India."""
  url = "https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY"
  headers = {
      "User-Agent": (
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML,"
          " like Gecko) Chrome/120.0.0.0 Safari/537.36"
      ),
      "Accept-Language": "en-US,en;q=0.9",
  }

  session = requests.Session()
  try:
    session.get("https://www.nseindia.com", headers=headers, timeout=5)
    response = session.get(url, headers=headers, timeout=5)

    if response.status_code == 200:
      data = response.json()
      records = data["records"]["data"]

      total_ce_oi = 0
      total_pe_oi = 0
      max_ce_oi, max_ce_strike = 0, 0
      max_pe_oi, max_pe_strike = 0, 0

      curr_expiry = data["records"]["expiryDates"][0]

      for item in records:
        if item.get("expiryDate") == curr_expiry:
          strike = item.get("strikePrice")
          if "CE" in item:
            ce_oi = item["CE"].get("openInterest", 0)
            total_ce_oi += ce_oi
            if ce_oi > max_ce_oi:
              max_ce_oi = ce_oi
              max_ce_strike = strike
          if "PE" in item:
            pe_oi = item["PE"].get("openInterest", 0)
            total_pe_oi += pe_oi
            if pe_oi > max_pe_oi:
              max_pe_oi = pe_oi
              max_pe_strike = strike

      pcr = total_pe_oi / total_ce_oi if total_ce_oi > 0 else 0
      return (
          f"• *Expiry Date*: `{curr_expiry}`\n"
          f"• *Put-Call Ratio (PCR)*: `{pcr:.2f}`"
          f" ({'Bullish 🟢' if pcr > 1.0 else 'Bearish 🔴' if pcr < 0.7 else 'Neutral ⚖️'})\n"
          f"• *Max Call OI (Heavy Resistance)*: `{max_ce_strike}` strike\n"
          f"• *Max Put OI (Heavy Support)*: `{max_pe_strike}` strike"
      )
  except Exception:
    return "• *NSE Option Chain*: Data temporarily unavailable"

  return "• *NSE Option Chain*: Data unavailable"


def fetch_market_analysis():
  global_tickers = {
      "Dow Jones": "^DJI",
      "S&P 500": "^GSPC",
      "Nasdaq Composite": "^IXIC",
  }

  summary_lines = [
      "📊 *Intraday Market Conviction & Technical Summary (15M)*\n"
  ]
  summary_lines.append(
      f"_Generated on: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} IST_\n"
  )

  # 1. Global Indices Overview via Yahoo Finance
  summary_lines.append("*1. Global Indices Overview:*")
  for name, ticker in global_tickers.items():
    try:
      df = yf.download(ticker, period="5d", progress=False)
      if not df.empty and len(df) >= 2:
        close_series = (
            df["Close"].iloc[:, 0]
            if isinstance(df.columns, pd.MultiIndex)
            else df["Close"]
        )
        current_price = float(close_series.iloc[-1])
        prev_price = float(close_series.iloc[-2])
        pct_change = ((current_price - prev_price) / prev_price) * 100
        summary_lines.append(
            f"• *{name}*: `{current_price:,.2f}` (`{pct_change:+.2f}%`)"
        )
    except Exception:
      summary_lines.append(f"• *{name}*: Data unavailable")

  # 2. Nifty 15-Minute SMAs & RSI via Fyers API
  try:
    to_date = int(datetime.datetime.now().timestamp())
    from_date = to_date - (5 * 86400)

    df_15m = fetch_fyers_history(
        "NSE:NIFTY50-INDEX", "15", str(from_date), str(to_date)
    )
    if not df_15m.empty:
      c_15m = df_15m["Close"]

      sma_20_15m = float(c_15m.rolling(window=20).mean().iloc[-1])
      sma_50_15m = float(c_15m.rolling(window=50).mean().iloc[-1])
      sma_100_15m = float(c_15m.rolling(window=100).mean().iloc[-1])
      last_close_15m = float(c_15m.iloc[-1])

      rsi_series = compute_rsi(c_15m, 14)
      current_rsi_15m = float(rsi_series.iloc[-1])

      summary_lines.append(
          "\n*2. Nifty 50 15-Min Trend & Momentum (Fyers Feed):*"
      )
      summary_lines.append(
          f"• *Current Price*: `{last_close_15m:,.2f}`\n"
          f"• *15M SMA 20*: `{sma_20_15m:,.2f}` | *15M SMA 50*:"
          f" `{sma_50_15m:,.2f}` | *15M SMA 100*: `{sma_100_15m:,.2f}`"
      )
      summary_lines.append(
          f"• *15-Min RSI (14)*: `{current_rsi_15m:.2f}` "
          f"({'Overbought 🔴' if current_rsi_15m > 70 else 'Oversold 🟢' if current_rsi_15m < 30 else 'Neutral ⚖️'})"
      )

      # 3. Classic Intraday Pivots (Calculated from Daily Fyers Data)
      df_daily = fetch_fyers_history(
          "NSE:NIFTY50-INDEX", "D", str(from_date), str(to_date)
      )
      if not df_daily.empty and len(df_daily) >= 2:
        prev_high = float(df_daily["High"].iloc[-2])
        prev_low = float(df_daily["Low"].iloc[-2])
        prev_close = float(df_daily["Close"].iloc[-2])

        pivot = (prev_high + prev_low + prev_close) / 3
        r1 = (2 * pivot) - prev_low
        s1 = (2 * pivot) - prev_high
        r2 = pivot + (prev_high - prev_low)
        s2 = pivot - (prev_high - prev_low)

        summary_lines.append("\n*3. Tighter Intraday Levels (Classic Pivots):*")
        summary_lines.append(f"• *Resistance (R2)*: `{r2:,.2f}`")
        summary_lines.append(f"• *Resistance (R1)*: `{r1:,.2f}`")
        summary_lines.append(f"• *Pivot Point*: `{pivot:,.2f}`")
        summary_lines.append(f"• *Support (S1)*: `{s1:,.2f}`")
        summary_lines.append(f"• *Support (S2)*: `{s2:,.2f}`")

        # 4. Directional Bias
        trend_bias = (
            "Bullish 🟢"
            if last_close_15m > sma_20_15m
            else ("Bearish 🔴" if last_close_15m < sma_20_15m else "Neutral ⚖️")
        )
        summary_lines.append(
            f"\n*4. 15-Min Directional Bias*: **{trend_bias}**"
        )
  except Exception as e:
    summary_lines.append(f"\n*2/3/4. Fyers Data Error*: `{str(e)}`")

  # 5. Live Open Interest Analysis
  summary_lines.append("\n*5. Live Option Chain & Weekly Expiry Dynamics:*")
  summary_lines.append(fetch_nse_option_chain())

  return "\n".join(summary_lines)


if __name__ == "__main__":
  message = fetch_market_analysis()
  send_telegram_message(message)