import os
import datetime
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


def fetch_market_data():
  # Define tickers
  tickers = {
      "Nifty 50": "^NSEI",
      "Bank Nifty": "^NSEBANK",
      "Nifty IT": "^CNXIT",
      "Nifty Midcap 100": "^CRSMID",
      "Nifty 100 (Largecap)": "^NIFTY100",
      "Dow Jones": "^DJI",
      "S&P 500": "^GSPC",
      "Nasdaq Composite": "^IXIC",
  }

  summary_lines = ["📊 *Market Conviction & 7-Day Analysis Summary*\n"]
  summary_lines.append(
      f"_Generated on: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} IST_\n"
  )

  nifty_data = None
  market_conviction = "Neutral ⚖️"

  summary_lines.append("*1. Domestic Indices (Last 7 Days):*")
  for name, ticker in tickers.items():
    try:
      df = yf.download(ticker, period="10d", progress=False)
      if not df.empty and len(df) >= 2:
        # Handle multi-index columns if returned by newer yfinance versions
        if isinstance(df.columns, pd.MultiIndex):
          close_series = df["Close"].iloc[:, 0]
        else:
          close_series = df["Close"]

        current_price = float(close_series.iloc[-1])
        prev_7d_price = float(
            close_series.iloc[-6] if len(close_series) >= 6 else close_series.iloc[0]
        )
        pct_change = ((current_price - prev_7d_price) / prev_7d_price) * 100

        summary_lines.append(
            f"• *{name}*: `{current_price:,.2f}` (`{pct_change:+.2f}%` 7D)"
        )

        if name == "Nifty 50":
          nifty_data = df
    except Exception as e:
      summary_lines.append(f"• *{name}*: Data unavailable (`{e}`)")

  # Support & Resistance / Directional estimation for Nifty 50
  if nifty_data is not None and not nifty_data.empty:
    if isinstance(nifty_data.columns, pd.MultiIndex):
      highs = nifty_data["High"].iloc[-7:]
      lows = nifty_data["Low"].iloc[-7:]
      closes = nifty_data["Close"].iloc[-7:]
    else:
      highs = nifty_data["High"].iloc[-7:]
      lows = nifty_data["Low"].iloc[-7:]
      closes = nifty_data["Close"].iloc[-7:]

    r1 = float(highs.max())
    s1 = float(lows.min())
    last_close = float(closes.iloc[-1])

    # Simple trend heuristic
    if last_close > float(closes.iloc[-3]):
      market_conviction = "Bullish 🟢"
    elif last_close < float(closes.iloc[-3]):
      market_conviction = "Bearish 🔴"

    summary_lines.append("\n*2. Nifty 50 Technical Levels (7-Day Range):*")
    summary_lines.append(f"• *Estimated Resistance (R1)*: `{r1:,.2f}`")
    summary_lines.append(f"• *Estimated Support (S1)*: `{s1:,.2f}`")
    summary_lines.append(f"• *Potential Directional Bias*: **{market_conviction}**")

  summary_lines.append(
      "\n_Note: Data sourced via Yahoo Finance feeds. Verify option chain OI data live on terminal._"
  )

  return "\n".join(summary_lines)


if __name__ == "__main__":
  message = fetch_market_data()
  send_telegram_message(message)
