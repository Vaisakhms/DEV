import datetime
import unittest

from strategy_engine import (
    _classify,
    _evaluation_window,
    _all_confirm_direction,
    _leg_bias,
    _level_veto,
    _oi_state,
    _scalp_opportunity,
    _trend,
    _trigger,
    evaluate_strategy,
)


class StrategyRuleTests(unittest.TestCase):
    def test_level_setups_accept_different_confirmation_types_in_same_direction(self):
        events = {
            "Nifty 50": {"direction": "CE", "kind": "support hold"},
            "Bank Nifty": {"direction": "CE", "kind": "resistance breakout"},
            "Nifty Midcap": {"direction": "CE", "kind": "support hold"},
            "Nifty 100": {"direction": "CE", "kind": "resistance breakout"},
        }
        self.assertTrue(
            _all_confirm_direction(
                events,
                ("Nifty 50", "Bank Nifty", "Nifty Midcap", "Nifty 100"),
                "CE",
            )
        )
        self.assertTrue(
            _all_confirm_direction(events, ("Nifty 50", "Bank Nifty"), "CE")
        )

    def test_time_exit_closes_position_without_a_current_premium(self):
        ist = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
        now = datetime.datetime(2026, 10, 23, 15, 0, tzinfo=ist)
        state = {
            "date": now.date().isoformat(),
            "trades": 1,
            "losses": 0,
            "realized_pnl": 0,
            "open_position": {
                "direction": "CE",
                "entry_premium": 100,
                "quantity": 25,
                "expiry_date": "2026-10-27",
            },
        }
        result, next_state = evaluate_strategy(
            now, {}, {}, None, None, state, 0, 100000, 25
        )
        self.assertEqual(result["position_action"], "EXIT CE")
        self.assertIsNone(next_state["open_position"])
        self.assertTrue(
            any("realized P&L is unavailable" in reason for reason in result["reasons"])
        )

    def test_expiry_day_close_honors_1445_without_a_current_premium(self):
        ist = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
        now = datetime.datetime(2026, 10, 27, 14, 45, tzinfo=ist)
        state = {
            "date": now.date().isoformat(),
            "trades": 1,
            "losses": 0,
            "realized_pnl": 0,
            "open_position": {
                "direction": "PE",
                "entry_premium": 100,
                "quantity": 25,
                "expiry_date": now.date().isoformat(),
            },
        }
        result, next_state = evaluate_strategy(
            now, {}, {}, None, None, state, 0, 100000, 25
        )
        self.assertEqual(result["position_action"], "EXIT PE")
        self.assertIsNone(next_state["open_position"])

    def test_level_veto_requires_nifty_confirmation_at_the_vetoed_level(self):
        resistance = {"name": "R1", "price": 100}
        nifty_breakout = {
            "kind": "resistance breakout",
            "level": resistance,
        }
        self.assertTrue(
            _level_veto("CE", 99.9, resistance, None, None)
        )
        self.assertFalse(
            _level_veto("CE", 99.9, resistance, None, nifty_breakout)
        )
        self.assertFalse(
            _level_veto("CE", 99.5, resistance, None, None)
        )

    def test_support_veto_requires_nifty_breakdown_at_the_vetoed_level(self):
        support = {"name": "S1", "price": 100}
        nifty_breakdown = {
            "kind": "support breakdown",
            "level": support,
        }
        self.assertTrue(
            _level_veto("PE", 100.1, None, support, None)
        )
        self.assertFalse(
            _level_veto("PE", 100.1, None, support, nifty_breakdown)
        )

    def test_evaluation_window_uses_ist_weekday_hours(self):
        ist = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
        self.assertTrue(
            _evaluation_window(datetime.datetime(2026, 10, 23, 10, 0, tzinfo=ist))
        )
        self.assertFalse(
            _evaluation_window(datetime.datetime(2026, 10, 23, 20, 0, tzinfo=ist))
        )
        self.assertFalse(
            _evaluation_window(datetime.datetime(2026, 10, 24, 10, 0, tzinfo=ist))
        )

    def test_trend_requires_close_sma20_sma50_order(self):
        self.assertEqual(
            _trend({"close": 110, "sma": {20: 105, 50: 100}}),
            "Bullish",
        )
        self.assertEqual(
            _trend({"close": 90, "sma": {20: 95, 50: 100}}),
            "Bearish",
        )
        self.assertEqual(
            _trend({"close": 100, "sma": {20: 105, 50: 95}}),
            "Mixed",
        )

    def test_three_minute_trigger_uses_completed_candle_values(self):
        frames = {
            "3m": {
                "candles": [
                    {"high": 101, "low": 98, "close": 100, "sma20": 99},
                    {"high": 103, "low": 100, "close": 102, "sma20": 100},
                ]
            }
        }
        self.assertEqual(_trigger(frames), "Bullish")

    def test_oi_buildup_mapping(self):
        self.assertEqual(_classify(3, 1), "Long buildup")
        self.assertEqual(_classify(3, -1), "Short buildup")
        self.assertEqual(_classify(-3, 1), "Short covering")
        self.assertEqual(_classify(-3, -1), "Long unwinding")
        self.assertEqual(_leg_bias("Short buildup", "PE"), "Bullish")
        self.assertEqual(_leg_bias("Long buildup", "PE"), "Bearish")

    def test_oi_requires_a_recent_matching_option_snapshot(self):
        now = datetime.datetime(2026, 10, 23, 10, 5, tzinfo=datetime.timezone(
            datetime.timedelta(hours=5, minutes=30)
        ))
        previous_chain = {}
        current_chain = {}
        for strike in range(22250, 22751, 50):
            key = str(float(strike))
            previous_chain[key] = {
                "CE": {"oi": 100, "ltp": 100},
                "PE": {"oi": 100, "ltp": 100},
            }
            current_chain[key] = {
                "CE": {"oi": 100, "ltp": 100},
                "PE": {"oi": 100, "ltp": 100},
            }
        current_chain["22500.0"]["CE"] = {"oi": 110, "ltp": 110}
        current_chain["22500.0"]["PE"] = {"oi": 105, "ltp": 95}
        current_chain["22450.0"]["PE"] = {"oi": 120, "ltp": 80}
        old = {
            "timestamp": (now - datetime.timedelta(minutes=5)).isoformat(),
            "expiry": "2026-10-27",
            "chain": previous_chain,
        }
        options = {
            "source": "Fyers",
            "captured_at": now.isoformat(),
            "expiry": "2026-10-27",
            "atm": 22500,
            "pcr": 1.2,
            "chain": current_chain,
        }
        result = _oi_state(options, old, now)
        self.assertIsNotNone(result)
        self.assertEqual(result["legs"]["CE"]["buildup"], "Long buildup")
        self.assertEqual(result["legs"]["PE"]["buildup"], "Short buildup")
        self.assertEqual(result["flow"], "Bullish")
        self.assertIsNone(
            _oi_state(
                {**options, "chain": {"22500.0": current_chain["22500.0"]}},
                old,
                now,
            )
        )
        self.assertIsNone(
            _oi_state(
                options,
                {
                    **old,
                    "timestamp": (
                        now - datetime.timedelta(minutes=10)
                    ).isoformat(),
                },
                now,
            )
        )

    def test_missing_required_inputs_always_wait(self):
        now = datetime.datetime(2026, 10, 23, 10, 0, tzinfo=datetime.timezone(
            datetime.timedelta(hours=5, minutes=30)
        ))
        decision, _ = evaluate_strategy(
            now=now,
            indices={},
            pivots=None,
            options=None,
            previous=None,
            state={},
            market_bias=100,
            account_size=100000,
            lot_size=25,
        )
        self.assertEqual(decision["decision"], "WAIT")
        self.assertIn("required_data", decision["entry_filters"])
        self.assertFalse(decision["entry_filters"]["required_data"])

    def test_scalp_signal_can_appear_while_main_strategy_waits(self):
        now = datetime.datetime(2026, 10, 23, 10, 0, tzinfo=datetime.timezone(
            datetime.timedelta(hours=5, minutes=30)
        ))
        frames = {
            "3m": {
                "candles": [
                    {"time": now.timestamp() - 360, "high": 101, "low": 98,
                     "close": 100, "sma20": 99},
                    {"time": now.timestamp() - 180, "high": 103, "low": 99,
                     "close": 102, "sma20": 99},
                ]
            },
            "5m": {
                "analysis": {"close": 102, "sma": {20: 101, 50: 100}},
                "candles": [{"time": now.timestamp() - 300}],
            },
            "15m": {
                "analysis": {"close": 102, "sma": {20: 101, 50: 100}},
                "candles": [{"time": now.timestamp() - 900}],
            },
        }
        options = {
            "source": "Fyers",
            "spot_live": True,
            "captured_at": now.isoformat(),
            "expiry_date": "2026-10-27",
            "spot": 102,
            "atm": 100,
            "ce": {"ltp": 10},
        }
        decision, _ = evaluate_strategy(
            now=now,
            indices={"Nifty 50": {"frames": frames}},
            pivots=None,
            options=options,
            previous=None,
            state={},
            market_bias=0,
            account_size=None,
            lot_size=65,
        )

        self.assertEqual(decision["decision"], "WAIT")
        self.assertEqual(
            decision["scalp_opportunity"]["decision"], "BUY ATM CE"
        )

    def test_scalp_signal_rejects_opposing_trend_and_expiry_day(self):
        now = datetime.datetime(2026, 10, 23, 10, 0, tzinfo=datetime.timezone(
            datetime.timedelta(hours=5, minutes=30)
        ))
        frames = {
            "3m": {
                "candles": [
                    {"time": now.timestamp() - 360, "high": 101, "low": 98,
                     "close": 100, "sma20": 99},
                    {"time": now.timestamp() - 180, "high": 103, "low": 99,
                     "close": 102, "sma20": 99},
                ]
            },
            "5m": {
                "analysis": {"close": 98, "sma": {20: 99, 50: 100}},
                "candles": [{"time": now.timestamp() - 300}],
            },
            "15m": {
                "analysis": {"close": 102, "sma": {20: 101, 50: 100}},
                "candles": [{"time": now.timestamp() - 900}],
            },
        }
        options = {
            "source": "Fyers",
            "spot_live": True,
            "captured_at": now.isoformat(),
            "expiry_date": "2026-10-27",
            "spot": 102,
            "atm": 100,
            "ce": {"ltp": 10},
        }
        decision, _ = evaluate_strategy(
            now=now,
            indices={"Nifty 50": {"frames": frames}},
            pivots=None,
            options=options,
            previous=None,
            state={},
            market_bias=0,
            account_size=None,
            lot_size=65,
        )

        self.assertEqual(decision["scalp_opportunity"]["decision"], "WAIT")
        self.assertIn("not aligned", decision["scalp_opportunity"]["reason"])

        frames["5m"]["analysis"] = {
            "close": 102, "sma": {20: 101, 50: 100}
        }
        options["expiry_date"] = "2026-10-23"
        decision, _ = evaluate_strategy(
            now=now,
            indices={"Nifty 50": {"frames": frames}},
            pivots=None,
            options=options,
            previous=None,
            state={},
            market_bias=0,
            account_size=None,
            lot_size=65,
        )
        self.assertEqual(decision["scalp_opportunity"]["decision"], "WAIT")
        self.assertIn("Expiry-day", decision["scalp_opportunity"]["reason"])

    def test_expiry_day_support_bounce_needs_broad_support_confirmation(self):
        now = datetime.datetime(2026, 10, 27, 10, 0, tzinfo=datetime.timezone(
            datetime.timedelta(hours=5, minutes=30)
        ))
        frames = {
            "3m": {
                "candles": [
                    {"time": now.timestamp() - 240, "open": 101.0,
                     "high": 101.5, "low": 100.8, "close": 101.0,
                     "sma20": 101.0},
                    {"time": now.timestamp() - 60, "open": 100.7,
                     "high": 101.1, "low": 100.4, "close": 100.9,
                     "sma20": 101.2},
                ]
            },
            "5m": {
                "analysis": {"close": 100.9, "sma": {20: 101, 50: 100}},
                "candles": [{"time": now.timestamp() - 60}],
            },
            "15m": {
                "analysis": {"close": 100.9, "sma": {20: 101, 50: 100}},
                "candles": [],
            },
        }
        nifty = {"frames": frames}
        options = {
            "source": "Fyers",
            "spot_live": True,
            "captured_at": now.isoformat(),
            "expiry_date": "2026-10-27",
            "spot": 100.9,
            "atm": 100,
            "ce": {"ltp": 10},
        }
        support = {
            "direction": "CE",
            "kind": "support hold",
            "level": {"price": 100.5},
        }
        broad_support = {
            "Nifty 50": support,
            "Bank Nifty": support,
            "Nifty Midcap": support,
        }

        opportunity = _scalp_opportunity(
            now,
            nifty,
            options,
            65,
            broad_support,
        )

        self.assertEqual(opportunity["decision"], "BUY ATM CE", opportunity)
        self.assertEqual(
            opportunity["support_confirmations"],
            ["Nifty 50", "Bank Nifty", "Nifty Midcap"],
        )

        weak_support = {
            "Nifty 50": support,
            "Bank Nifty": support,
        }
        opportunity = _scalp_opportunity(
            now,
            nifty,
            options,
            65,
            weak_support,
        )
        self.assertEqual(opportunity["decision"], "WAIT")
        self.assertIn("3 of 4", opportunity["reason"])

    def test_expiry_day_support_bounce_requires_reclaim_and_rejection(self):
        now = datetime.datetime(2026, 10, 27, 10, 0, tzinfo=datetime.timezone(
            datetime.timedelta(hours=5, minutes=30)
        ))
        nifty = {
            "frames": {
                "3m": {
                    "candles": [
                        {"time": now.timestamp() - 240, "high": 101.5},
                        {"time": now.timestamp() - 60, "open": 100.7,
                         "high": 101.1, "low": 100.4, "close": 100.4,
                         "sma20": 101.2},
                    ]
                },
                "5m": {
                    "analysis": {"close": 100.9, "sma": {20: 101, 50: 100}},
                    "candles": [{"time": now.timestamp() - 60}],
                },
                "15m": {
                    "analysis": {"close": 100.9, "sma": {20: 101, 50: 100}},
                },
            }
        }
        options = {
            "source": "Fyers",
            "spot_live": True,
            "captured_at": now.isoformat(),
            "expiry_date": "2026-10-27",
            "spot": 100.9,
            "atm": 100,
            "ce": {"ltp": 10},
        }
        support = {
            "direction": "CE",
            "kind": "support hold",
            "level": {"price": 100.5},
        }
        events = {
            "Nifty 50": support,
            "Bank Nifty": support,
            "Nifty Midcap": support,
        }

        opportunity = _scalp_opportunity(
            now,
            nifty,
            options,
            65,
            events,
        )

        self.assertEqual(opportunity["decision"], "WAIT")
        self.assertIn("3m support bounce", opportunity["reason"])

        candles = nifty["frames"]["3m"]["candles"]
        candles[0] = {
            "time": now.timestamp() - 240,
            "open": 101.1,
            "high": 101.5,
            "low": 101.0,
            "close": 101.2,
            "sma20": 101.2,
        }
        candles[1]["close"] = 100.9
        candles[1]["sma20"] = 101.2
        opportunity = _scalp_opportunity(
            now,
            nifty,
            options,
            65,
            events,
        )
        self.assertEqual(opportunity["decision"], "WAIT")
        self.assertIn("breakdown", opportunity["reason"])

    def test_strategy_uses_multi_index_support_holds_for_expiry_day_scalp(self):
        now = datetime.datetime(2026, 10, 27, 10, 0, tzinfo=datetime.timezone(
            datetime.timedelta(hours=5, minutes=30)
        ))
        indices = {}
        for name in (
            "Nifty 50", "Bank Nifty", "Nifty Midcap", "Nifty 100"
        ):
            indices[name] = {
                "pivots": {"S1": 100.5},
                "frames": {
                    "3m": {
                        "candles": [
                            {"time": now.timestamp() - 240, "open": 101.0,
                             "high": 101.0, "low": 100.5, "close": 100.9,
                             "sma20": 101.0},
                            {"time": now.timestamp() - 60, "open": 100.7,
                             "high": 100.8, "low": 100.4, "close": 100.6,
                             "sma20": 101.0},
                        ]
                    },
                    "5m": {
                        "analysis": {
                            "close": 100.6,
                            "sma": {20: 101, 50: 100},
                        },
                        "candles": [{"time": now.timestamp() - 60}],
                    },
                    "15m": {
                        "analysis": {
                            "close": 100.6,
                            "sma": {20: 101, 50: 100},
                        },
                        "candles": [{
                            "time": now.timestamp() - 60,
                            "open": 100.7,
                            "high": 100.8,
                            "low": 100.3,
                            "close": 100.6,
                        }],
                    },
                },
            }
        options = {
            "source": "Fyers",
            "spot_live": True,
            "captured_at": now.isoformat(),
            "expiry_date": "2026-10-27",
            "spot": 100.6,
            "atm": 100,
            "ce": {"ltp": 10},
        }

        decision, _ = evaluate_strategy(
            now=now,
            indices=indices,
            pivots={"S1": 100.5},
            options=options,
            previous=None,
            state={},
            market_bias=0,
            account_size=None,
            lot_size=65,
        )

        self.assertEqual(
            decision["scalp_opportunity"]["decision"],
            "BUY ATM CE",
            decision["scalp_opportunity"],
        )
        self.assertEqual(
            len(decision["scalp_opportunity"]["support_confirmations"]),
            4,
        )

    def test_valid_aligned_setup_can_emit_atm_call_signal(self):
        now = datetime.datetime(2026, 10, 23, 10, 0, tzinfo=datetime.timezone(
            datetime.timedelta(hours=5, minutes=30)
        ))
        indices = {}
        for name in (
            "Nifty 50", "Bank Nifty", "Nifty Midcap", "Nifty 100"
        ):
            frames = {}
            for timeframe, seconds in (
                ("3m", 180), ("5m", 300), ("10m", 600), ("15m", 900),
                ("30m", 1800), ("1h", 3600), ("Daily", 86400),
            ):
                analysis = {
                    "close": 100,
                    "sma": {20: 99, 50: 98, 100: 97},
                    "rsi": 55,
                }
                if timeframe == "3m":
                    candles = [
                        {"time": now.timestamp() - seconds * 2, "open": 99,
                         "high": 101, "low": 98, "close": 100, "sma20": 99},
                        {"time": now.timestamp() - seconds, "open": 100,
                         "high": 103, "low": 99, "close": 102, "sma20": 99},
                    ]
                elif timeframe == "15m":
                    candles = [
                        {"time": now.timestamp() - seconds * offset,
                         "open": 100, "high": 101, "low": 99, "close": 100}
                        for offset in range(9, 0, -1)
                    ]
                    candles[-1].update({
                        "open": 100, "high": 103, "low": 99, "close": 102
                    })
                    analysis["close"] = 102
                else:
                    candles = [{
                        "time": now.timestamp() - seconds,
                        "open": 99, "high": 101, "low": 98, "close": 100,
                    }]
                frames[timeframe] = {
                    "analysis": analysis,
                    "candles": candles,
                }
            indices[name] = {
                "frames": frames,
                "pivots": {"S1": 90, "S2": 80, "R1": 110, "R2": 120},
                "completed_sessions_count": 7,
                "previous_day_high": 110,
                "previous_day_low": 90,
                "seven_day_high": 115,
                "seven_day_low": 85,
            }
        previous = {
            "timestamp": (now - datetime.timedelta(minutes=5)).isoformat(),
            "expiry": "27-10-2026",
            "chain": {
                str(float(strike)): {
                    "CE": {"oi": 100, "ltp": 100},
                    "PE": {"oi": 100, "ltp": 100},
                }
                for strike in range(-150, 351, 50)
            },
        }
        options = {
            "source": "Fyers",
            "captured_at": now.isoformat(),
            "expiry": "27-10-2026",
            "expiry_date": "2026-10-27",
            "atm": 100,
            "spot": 102,
            "spot_live": True,
            "pcr": 1.1,
            "lot_size": 65,
            "support": 90,
            "resistance": 110,
            "ce": {"ltp": 100},
            "pe": {"ltp": 100},
            "chain": {
                str(float(strike)): {
                    "CE": {
                        "oi": 110 if strike == 100 else 100,
                        "ltp": 110 if strike == 100 else 100,
                    },
                    "PE": {
                        "oi": 120 if strike == 50 else 100,
                        "ltp": 80 if strike == 50 else 100,
                    },
                }
                for strike in range(-150, 351, 50)
            },
        }
        decision, next_state = evaluate_strategy(
            now=now,
            indices=indices,
            pivots=indices["Nifty 50"]["pivots"],
            options=options,
            previous=previous,
            state={"date": now.date().isoformat(), "trades": 0, "losses": 0},
            market_bias=0,
            account_size=100000,
            lot_size=65,
        )
        self.assertEqual(decision["decision"], "BUY ATM CE", decision)
        self.assertEqual(decision["trigger_3m"], "Bullish")
        self.assertIsNotNone(next_state["open_position"])
        self.assertEqual(next_state["open_position"]["quantity"], 65)

    def test_stop_exit_updates_daily_risk_state(self):
        now = datetime.datetime(2026, 10, 23, 10, 0, tzinfo=datetime.timezone(
            datetime.timedelta(hours=5, minutes=30)
        ))
        decision, next_state = evaluate_strategy(
            now=now,
            indices={},
            pivots=None,
            options={"ce": {"ltp": 79}, "pe": {"ltp": 20}},
            previous=None,
            state={
                "date": now.date().isoformat(),
                "trades": 1,
                "losses": 0,
                "realized_pnl": 0,
                "open_position": {
                    "direction": "CE",
                    "entry_premium": 100,
                    "quantity": 25,
                    "stop_pct": -20,
                    "entered_at": now.isoformat(),
                },
            },
            market_bias=0,
            account_size=100000,
            lot_size=25,
        )
        self.assertEqual(decision["decision"], "WAIT")
        self.assertEqual(decision["position_action"], "EXIT CE")
        self.assertIsNone(next_state["open_position"])
        self.assertEqual(next_state["losses"], 1)
        self.assertEqual(next_state["realized_pnl"], -525)
        self.assertEqual(next_state["last_stop_at"], now.isoformat())


if __name__ == "__main__":
    unittest.main()
