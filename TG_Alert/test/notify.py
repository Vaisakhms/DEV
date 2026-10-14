import datetime
import os
import numpy as np
import pandas as pd
import requests
import yfinance as yf

# Load credentials from GitHub Secrets
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")


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


def fetch_nse_option_chain():
  """Fetches live Open Interest (PCR, Max Call/Put OI) from NSE India."""
  url = "https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY"
  headers = {
      "User-Agent": (
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML,"
          " like Gecko) Chrome/120.0.0.0 Safari/537.36"
      ),
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
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
    return "• *NSE Option Chain*: Feed temporarily unreachable (Market closed or rate-limited)"

  return "• *NSE Option Chain*: Data unavailable"


def fetch_market_analysis():
  tickers = {
      "Nifty 50": "^NSEI",
      "Bank Nifty": "^NSEBANK",
      "Nifty IT": "^CNXIT",
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

  # 1. Fetch Indices Overview (7-Day Performance)
  summary_lines.append("*1. Indices Overview (7-Day Performance):*")
  for name, ticker in tickers.items():
    try:
      df = yf.download(ticker, period="10d", progress=False)
      if not df.empty and len(df) >= 2:
        close_series = (
            df["Close"].iloc[:, 0]
            if isinstance(df.columns, pd.MultiIndex)
            else df["Close"]
        )
        current_price = float(close_series.iloc[-1])
        prev_7d_price = float(
            close_series.iloc[-6]
            if len(close_series) >= 6
            else close_series.iloc[0]
        )
        pct_change = ((current_price - prev_7d_price) / prev_7d_price) * 100
        summary_lines.append(
            f"• *{name}*: `{current_price:,.2f}` (`{pct_change:+.2f}%`)"
        )
    except Exception:
      summary_lines.append(f"• *{name}*: Data unavailable")

  # 2. Nifty 15-Minute SMAs & RSI
  try:
    df_15m = yf.download("^NSEI", period="5d", interval="15m", progress=False)
    if not df_15m.empty:
      c_15m = (
          df_15m["Close"].iloc[:, 0]
          if isinstance(df_15m.columns, pd.MultiIndex)
          else df_15m["Close"]
      )

      sma_20_15m = float(c_15m.rolling(window=20).mean().iloc[-1])
      sma_50_15m = float(c_15m.rolling(window=50).mean().iloc[-1])
      sma_100_15m = float(c_15m.rolling(window=100).mean().iloc[-1])
      last_close_15m = float(c_15m.iloc[-1])

      rsi_series = compute_rsi(c_15m, 14)
      current_rsi_15m = float(rsi_series.iloc[-1])

      summary_lines.append(
          "\n*2. Nifty 50 15-Min Trend & Momentum (SMAs & RSI):*"
      )
      summary_lines.append(
          f"• *15M SMA 20*: `{sma_20_15m:,.2f}` | *15M SMA 50*:"
          f" `{sma_50_15m:,.2f}` | *15M SMA 100*: `{sma_100_15m:,.2f}`"
      )
      summary_lines.append(
          f"• *15-Min RSI (14)*: `{current_rsi_15m:.2f}` "
          f"({'Overbought 🔴' if current_rsi_15m > 70 else 'Oversold 🟢' if current_rsi_15m < 30 else 'Neutral ⚖️'})"
      )
  except Exception:
    summary_lines.append(
        "\n*2. Nifty 50 15-Min Trend & Momentum:* Data unavailable"
    )

  # 3. Classic Intraday Pivots (Calculated from Daily High/Low/Close)
  try:
    df_daily = yf.download("^NSEI", period="5d", progress=False)
    if not df_daily.empty and len(df_daily) >= 2:
      d_high = (
          df_daily["High"].iloc[:, 0]
          if isinstance(df_daily.columns, pd.MultiIndex)
          else df_daily["High"]
      )
      d_low = (
          df_daily["Low"].iloc[:, 0]
          if isinstance(df_daily.columns, pd.MultiIndex)
          else df_daily["Low"]
      )
      d_close = (
          df_daily["Close"].iloc[:, 0]
          if isinstance(df_daily.columns, pd.MultiIndex)
          else df_daily["Close"]
      )

      prev_high = float(d_high.iloc[-2])
      prev_low = float(d_low.iloc[-2])
      prev_close = float(d_close.iloc[-2])

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

      # 4. Directional Bias based on 15M price vs 15M SMA 20
      trend_bias = (
          "Bullish 🟢"
          if last_close_15m > sma_20_15m
          else ("Bearish 🔴" if last_close_15m < sma_20_15m else "Neutral ⚖️")
      )
      summary_lines.append(
          f"\n*4. 15-Min Directional Bias*: **{trend_bias}**"
      )
  except Exception:
    summary_lines.append("\n*3/4. Pivot & Directional Bias*: Unavailable")

  # 5. Live Open Interest Analysis
  summary_lines.append("\n*5. Live Option Chain & Weekly Expiry Dynamics:*")
  summary_lines.append(fetch_nse_option_chain())

  return "\n".join(summary_lines)


if __name__ == "__main__":
  message = fetch_market_analysis()
  send_telegram_message(message)
