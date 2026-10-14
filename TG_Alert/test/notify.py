import datetime
import os
import numpy as np
import pandas as pd
import requests
import yfinance as yf

# 1. Load credentials from GitHub Secrets
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
  rsi = 100 - (100 / (1 + rs))
  return rsi


def fetch_market_analysis():
  tickers = {
      "Nifty 50": "^NSEI",
      "Bank Nifty": "^NSEBANK",
      "Nifty IT": "^CNXIT",
      "Dow Jones": "^DJI",
      "S&P 500": "^GSPC",
      "Nasdaq Composite": "^IXIC",
  }

  summary_lines = ["📊 *Advanced Market Conviction & Technical Summary*\n"]
  summary_lines.append(
      f"_Generated on: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} IST_\n"
  )

  nifty_daily = None
  nifty_30m = None

  # 1. Fetch Daily Indices Performance
  summary_lines.append("*1. Indices Overview (7-Day Performance):*")
  for name, ticker in tickers.items():
    try:
      df = yf.download(ticker, period="10d", progress=False)
      if not df.empty and len(df) >= 2:
        if isinstance(df.columns, pd.MultiIndex):
          close_series = df["Close"].iloc[:, 0]
        else:
          close_series = df["Close"]

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

        if name == "Nifty 50":
          nifty_daily = df
    except Exception as e:
      summary_lines.append(f"• *{name}*: Data unavailable")

  # 2. Nifty 50 Technical Indicators (SMAs & 30m RSI)
  if nifty_daily is not None and not nifty_daily.empty:
    if isinstance(nifty_daily.columns, pd.MultiIndex):
      d_close = nifty_daily["Close"].iloc[:, 0]
      d_high = nifty_daily["High"].iloc[:, 0]
      d_low = nifty_daily["Low"].iloc[:, 0]
    else:
      d_close = nifty_daily["Close"]
      d_high = nifty_daily["High"]
      d_low = nifty_daily["Low"]

    # Calculate Daily SMAs (20, 50, 100)
    sma_20 = float(d_close.rolling(window=20).mean().iloc[-1])
    sma_50 = float(d_close.rolling(window=50).mean().iloc[-1])
    sma_100 = float(d_close.rolling(window=100).mean().iloc[-1])
    last_close = float(d_close.iloc[-1])

    summary_lines.append("\n*2. Nifty 50 Trend & Momentum (Daily SMAs):*")
    summary_lines.append(
        f"• *SMA 20*: `{sma_20:,.2f}` | *SMA 50*: `{sma_50:,.2f}` | *SMA 100*:"
        f" `{sma_100:,.2f}`"
    )

    # Fetch 30-minute data for RSI
    try:
      df_30m = yf.download(
          "^NSEI", period="5d", interval="30m", progress=False
        )
      if not df_30m.empty:
        if isinstance(df_30m.columns, pd.MultiIndex):
          c_30m = df_30m["Close"].iloc[:, 0]
        else:
          c_30m = df_30m["Close"]
        rsi_series = compute_rsi(c_30m, 14)
        current_rsi = float(rsi_series.iloc[-1])
        summary_lines.append(
            f"• *30-Min RSI (14)*: `{current_rsi:.2f}` "
            f"({'Overbought 🔴' if current_rsi > 70 else 'Oversold 🟢' if current_rsi < 30 else 'Neutral ⚖️'})"
        )
    except Exception:
      summary_lines.append("• *30-Min RSI*: Unavailable")

    # 3. Tighter Intraday Support & Resistance (Pivot Point Method)
    prev_high = float(d_high.iloc[-2])
    prev_low = float(d_low.iloc[-2])
    prev_close = float(d_close.iloc[-2])

    pivot = (prev_high + prev_low + prev_close) / 3
    r1 = (2 * pivot) - prev_low
    s1 = (2 * pivot) - prev_high
    r2 = pivot + (prev_high - prev_low)
    s2 = pivot - (prev_high - prev_low)

    summary_lines.append(
        "\n*3. Tighter Intraday Levels (Classic Pivots):* "
    )
    summary_lines.append(f"• *Resistance (R2)*: `{r2:,.2f}`")
    summary_lines.append(f"• *Resistance (R1)*: `{r1:,.2f}`")
    summary_lines.append(f"• *Pivot Point*: `{pivot:,.2f}`")
    summary_lines.append(f"• *Support (S1)*: `{s1:,.2f}`")
    summary_lines.append(f"• *Support (S2)*: `{s2:,.2f}`")

    # 4. Directional Bias & Expiry / OI Structural Proxy Note
    trend_bias = (
        "Bullish 🟢"
        if last_close > sma_20
        else ("Bearish 🔴" if last_close < sma_20 else "Neutral ⚖️")
    )
    summary_lines.append(f"\n*4. Potential Directional Bias*: **{trend_bias}**")

  summary_lines.append(
      "\n*5. OI & Weekly Expiry Dynamics:* \n"
      "_Note: Automated public feeds do not stream live NSE Option Chain OI._ "
      "_Check your broker terminal (e.g., PCR levels, Max Pain strike near"
      " current pivot, and heavy Call/Put writing clusters) to confirm weekly"
      " expiry conviction before trade execution._"
  )

  return "\n".join(summary_lines)


if __name__ == "__main__":
  message = fetch_market_analysis()
  send_telegram_message(message)
