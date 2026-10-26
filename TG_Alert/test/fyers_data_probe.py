"""Read-only probe of FYERS futures history, quotes, and option-chain fields."""

import csv
import datetime
import os

import requests

from notify import IST, get_fyers_client


INSTRUMENT_MASTER_URL = "https://public.fyers.in/sym_details/NSE_FO.csv"
UNDERLYINGS = ("NIFTY", "BANKNIFTY")


def active_future_symbols(now):
    """Find the nearest unexpired Nifty and Bank Nifty futures symbols."""
    nearest = {}
    today_epoch = int(now.timestamp())

    with requests.get(INSTRUMENT_MASTER_URL, stream=True, timeout=20) as response:
        response.raise_for_status()
        response.encoding = "utf-8"
        for raw_line in response.iter_lines(decode_unicode=True):
            if not raw_line:
                continue
            row = next(csv.reader([raw_line]))
            if len(row) < 14 or row[13].strip() not in UNDERLYINGS:
                continue
            if not row[9].strip().endswith("FUT"):
                continue
            try:
                expiry_epoch = int(row[8])
            except (TypeError, ValueError):
                continue
            underlying = row[13].strip()
            if expiry_epoch < today_epoch:
                continue
            if (
                underlying not in nearest
                or expiry_epoch < nearest[underlying][0]
            ):
                nearest[underlying] = (expiry_epoch, row[9].strip())

    return {
        underlying: symbol
        for underlying, (_, symbol) in nearest.items()
    }


def append_summary(lines):
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as summary:
            summary.write("\n".join(lines) + "\n")
    print("\n".join(lines))


def main():
    now = datetime.datetime.now(IST)
    lines = [
        "## FYERS read-only data probe",
        "",
        "Captured at %s; credentials and raw responses are not logged."
        % now.isoformat(),
        "",
    ]

    try:
        symbols = active_future_symbols(now)
    except requests.RequestException as exc:
        append_summary(lines + [
            "- Instrument master: **FAILED** (%s)" % type(exc).__name__,
        ])
        raise RuntimeError("Unable to read the public FYERS instrument master.") from exc

    missing = sorted(set(UNDERLYINGS) - set(symbols))
    lines.append("- Active future symbols: %s" % (
        ", ".join("%s: `%s`" % item for item in sorted(symbols.items()))
        if symbols else "none found"
    ))
    if missing:
        lines.append("- Missing active futures: %s" % ", ".join(missing))

    fyers = get_fyers_client()
    if not fyers:
        append_summary(lines + ["- FYERS authentication: **FAILED**"])
        raise RuntimeError("FYERS client could not be authenticated.")
    lines.append("- FYERS authentication: **OK**")

    range_to = int(now.timestamp())
    range_from = int((now - datetime.timedelta(days=2)).timestamp())
    for underlying, symbol in sorted(symbols.items()):
        for continuous in (False, True):
            mode = "continuous" if continuous else "specific contract"
            try:
                history = fyers.history(data={
                    "symbol": symbol,
                    "resolution": "1",
                    "date_format": "0",
                    "range_from": str(range_from),
                    "range_to": str(range_to),
                    "cont_flag": "1" if continuous else "0",
                })
            except Exception as exc:
                lines.append(
                    "- %s %s 1-minute history: **FAILED** (%s)"
                    % (underlying, mode, type(exc).__name__)
                )
            else:
                candles = history.get("candles") or []
                if history.get("s") == "ok" and candles:
                    field_count = len(candles[-1])
                    lines.append(
                        "- %s %s 1-minute history: **OK** "
                        "(%d candles, %d fields/candle)"
                        % (underlying, mode, len(candles), field_count)
                    )
                else:
                    lines.append(
                        "- %s %s 1-minute history: **NO DATA** (%s)"
                        % (
                            underlying,
                            mode,
                            history.get("message")
                            or history.get("s")
                            or "unknown response",
                        )
                    )

    if symbols:
        try:
            quotes = fyers.quotes(data={
                "symbols": ",".join(symbols.values()),
            })
        except Exception as exc:
            lines.append("- Futures quotes: **FAILED** (%s)" % type(exc).__name__)
        else:
            quote_items = quotes.get("d") or []
            if quotes.get("s") != "ok" or not quote_items:
                lines.append(
                    "- Futures quotes: **NO DATA** (%s)"
                    % (quotes.get("message") or quotes.get("s") or "unknown response")
                )
            else:
                for item in quote_items:
                    values = item.get("v") or {}
                    fields = sorted(values)
                    oi_fields = [
                        key for key in fields
                        if key.lower() in ("oi", "oich", "oichp", "open_interest")
                    ]
                    lines.append(
                        "- Quote `%s`: fields `%s`; OI fields: `%s`"
                        % (
                            item.get("n", "unknown symbol"),
                            "`, `".join(fields) or "none",
                            ", ".join(oi_fields) or "not present",
                        )
                    )

    try:
        option_chain = fyers.optionchain(data={
            "symbol": "NSE:NIFTY50-INDEX",
            "strikecount": 2,
            "timestamp": "",
        })
    except Exception as exc:
        lines.append("- Nifty option-chain API: **FAILED** (%s)" % type(exc).__name__)
    else:
        records = option_chain.get("data") or {}
        chain = records.get("optionsChain") or []
        sample = next(
            (
                row for row in chain
                if row.get("option_type") in ("CE", "PE")
            ),
            {},
        )
        if option_chain.get("s") == "ok" and sample:
            lines.append(
                "- Nifty option-chain API: **OK**; sample fields `%s`"
                % "`, `".join(sorted(sample))
            )
        else:
            lines.append(
                "- Nifty option-chain API: **NO DATA** (%s)"
                % (
                    option_chain.get("message")
                    or option_chain.get("s")
                    or "response shape differed"
                )
            )

    lines.extend([
        "",
        "This probe is read-only. FYERS candle history and quote fields do not "
        "by themselves establish trade aggressor-side delta or footprint data.",
    ])
    append_summary(lines)


if __name__ == "__main__":
    main()
