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
      "📊 *Multi-Timeframe Market Conviction & Technical Summary*\n"
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

  # 2. Multi-Timeframe Analysis (15m, 30m, 1h) for Nifty 50, Bank Nifty, Nifty Midcap
  summary_lines.append(
      "\n*2. Multi-Timeframe Index Directional Analysis (15M, 30M, 1H):*"
  )

  indices = {
      "Nifty 50": "NSE:NIFTY50-INDEX",
      "Bank Nifty": "NSE:NIFTYBANK-INDEX",
      "Nifty Midcap": "NSE:NIFTYMID50-INDEX",
  }

  timeframes = {"15m": "15", "30m": "30", "1h": "60"}

  try:
    to_date = int(datetime.datetime.now().timestamp())
    from_date = to_date - (10 * 86400)

    for index_name, symbol in indices.items():
      summary_lines.append(f"\n• *{index_name}*:")
      tf_biases = []

      for tf_label, tf_res in timeframes.items():
        df_tf = fetch_fyers_history(
            symbol, tf_res, str(from_date), str(to_date)
        )
        if not df_tf.empty and len(df_tf) >= 20:
          c_series = df_tf["Close"]
          last_close = float(c_series.iloc[-1])
          ema_9 = float(c_series.ewm(span=9, adjust=False).mean().iloc[-1])
          ema_20 = float(c_series.ewm(span=20, adjust=False).mean().iloc[-1])
          rsi_val = float(compute_rsi(c_series, 14).iloc[-1])

          if last_close > ema_9 and ema_9 > ema_20:
            bias = "Bullish 🟢"
            tf_biases.append("Bullish")
          elif last_close < ema_9 and ema_9 < ema_20:
            bias = "Bearish 🔴"
            tf_biases.append("Bearish")
          else:
            bias = "Neutral ⚖️"
            tf_biases.append("Neutral")

          summary_lines.append(
              f"  - *{tf_label}*: Close=`{last_close:,.2f}` | EMA9=`{ema_9:,.2f}`"
              f" | EMA20=`{ema_20:,.2f}` | RSI=`{rsi_val:.1f}` ({bias})"
          )
        else:
          summary_lines.append(f"  - *{tf_label}*: Data unavailable")

      if tf_biases:
        bull_count = tf_biases.count("Bullish")
        bear_count = tf_biases.count("Bearish")
        if bull_count >= 2:
          overall_idx_bias = "Strong Bullish 🟢"
        elif bear_count >= 2:
          overall_idx_bias = "Strong Bearish 🔴"
        else:
          overall_idx_bias = "Sideways / Mixed ⚖️"
        summary_lines.append(
            f"  👉 *Potential Direction Bias*: **{overall_idx_bias}**"
        )

    # 3. Classic Intraday Pivots for Nifty 50 (Calculated from Daily Fyers Data)
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

      summary_lines.append(
          "\n*3. Nifty 50 Intraday Levels (Classic Pivots):*"
      )
      summary_lines.append(f"• *Resistance (R2)*: `{r2:,.2f}`")
      summary_lines.append(f"• *Resistance (R1)*: `{r1:,.2f}`")
      summary_lines.append(f"• *Pivot Point*: `{pivot:,.2f}`")
      summary_lines.append(f"• *Support (S1)*: `{s1:,.2f}`")
      summary_lines.append(f"• *Support (S2)*: `{s2:,.2f}`")

  except Exception as e:
    summary_lines.append(f"\n*Fyers Analysis Error*: `{str(e)}`")

  # 4. Live Open Interest Analysis
  summary_lines.append("\n*4. Live Option Chain & Weekly Expiry Dynamics:*")
  summary_lines.append(fetch_nse_option_chain())

  return "\n".join(summary_lines)


if __name__ == "__main__":
  message = fetch_market_analysis()
  send_telegram_message(message)