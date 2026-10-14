import os
import requests

# 1. Load credentials from GitHub Secrets (or set them locally for testing)
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")


def send_telegram_message(message):
  url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
  payload = {"chat_id": TELEGRAM_CHAT_ID, "text": message, "parse_mode": "Markdown"}
  response = requests.post(url, json=payload)

  if response.status_code == 200:
    print("Notification sent successfully!")
  else:
    print(f"Failed to send notification: {response.text}")


if __name__ == "__main__":
  # Put the main logic of your script here, or call this at the end of your workflow
  message = "✅ *Success!* Your GitHub script ran successfully and completed its task."
  send_telegram_message(message)
