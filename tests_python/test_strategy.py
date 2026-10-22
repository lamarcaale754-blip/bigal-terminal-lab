"""Exercise the retained entry/exit strategy with injected time and market input."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from bot import bigalbot_customizable as bot
from bot.offline_feed import offline_events
from bot.executor import ExecutionUncertain


@pytest.fixture
def state(monkeypatch, tmp_path):
    bot.reset_state()
    monkeypatch.setattr(bot, "DATA_DIR", tmp_path)
    monkeypatch.setattr(bot, "TRADE_JOURNAL_FILE", tmp_path / "trades.csv")
    monkeypatch.setattr(bot, "CUSTOM_PRESETS_FILE", tmp_path / "presets.json")
    clock = SimpleNamespace(now=1000.0)
    monkeypatch.setattr(
        bot,
        "time",
        SimpleNamespace(time=lambda: clock.now, monotonic=lambda: clock.now),
    )
    return clock


async def open_position(clock, cycle=0):
    events = list(offline_events(cycle))
    for event in events[:5]:
        await bot.ingest_event(event)
        clock.now += 1
    return events[0]["mint"], events


@pytest.mark.asyncio
async def test_actual_strategy_opens_and_takes_profit_from_market_events(state):
    mint, events = await open_position(state)
    assert mint in bot.positions
    assert bot.paper_balance == pytest.approx(9.95)
    entry = bot.positions[mint].entry_price
    for event in events[5:20]:
        await bot.ingest_event(event)
        state.now += 1
    assert mint not in bot.positions
    assert bot.wins == 1 and bot.losses == 0
    assert bot.realized_pnl > 0
    assert bot.paper_balance == pytest.approx(10 + bot.realized_pnl)
    trade = bot.trade_history[-1]
    assert trade["reason"] == "TP2"
    assert trade["pnl_sol"] == pytest.approx(
        0.05 * (events[12]["vSolInBondingCurve"] / 1e6 / entry - 1), abs=1e-6
    )
    assert trade["simulated"] is True
    assert trade["execution_confirmed"] is False
    assert trade["ts"] == trade["timestamp"]


@pytest.mark.asyncio
async def test_adverse_fixture_closes_at_a_loss(state):
    mint, events = await open_position(state, 1)
    for event in events[5:]:
        await bot.ingest_event(event)
        state.now += 1
    assert mint not in bot.positions
    assert bot.losses == 1 and bot.wins == 0
    assert bot.realized_pnl < 0
    assert bot.paper_balance == pytest.approx(10 + bot.realized_pnl)


@pytest.mark.asyncio
async def test_entry_filters_reject_uniform_volume_and_pause_blocks_new_entries(state):
    for event in list(offline_events())[:9]:
        if event["txType"] != "create":
            event["solAmount"] = 0.5
        await bot.ingest_event(event)
        state.now += 1
    assert not bot.positions
    assert bot.execution_counters["skip_anti_manip_diversity"] > 0
    bot.TRADING_PAUSED = True
    await bot.ingest_event(list(offline_events(2))[0])
    for event in list(offline_events(2))[1:8]:
        await bot.ingest_event(event)
        state.now += 1
    assert not bot.positions
    assert bot.execution_counters["skip_paused"] > 0


@pytest.mark.asyncio
async def test_manual_sell_is_idempotent_and_restores_principal(state):
    mint, _ = await open_position(state)
    assert await bot.manual_sell_position(mint) is True
    assert await bot.manual_sell_position(mint) is False
    assert not bot.positions
    assert bot.paper_balance == pytest.approx(10)
    assert len(bot.trade_history) == 1


@pytest.mark.asyncio
async def test_failed_mock_live_buy_releases_reservation(state):
    bot.OFFLINE = False
    bot.MODE_LIVE = True
    bot.executor = SimpleNamespace(
        buy=AsyncMock(return_value=None),
        get_balance=AsyncMock(return_value=None),
        latency_dict=lambda: {},
    )
    mint, _ = await open_position(state)
    assert mint not in bot.positions
    assert bot.paper_balance == pytest.approx(10)
    assert bot.execution_counters["buy_failed_chain"] == 1
    bot.executor.buy.assert_awaited_once()


@pytest.mark.asyncio
async def test_failed_mock_live_sell_keeps_position_and_clears_close_guard(state):
    mint, _ = await open_position(state)
    bot.OFFLINE = False
    bot.MODE_LIVE = True
    bot.executor = SimpleNamespace(
        sell=AsyncMock(return_value=None),
        get_balance=AsyncMock(return_value=None),
        latency_dict=lambda: {},
    )
    result = await bot.manual_sell_position(mint)
    assert not result
    assert mint in bot.positions
    assert bot.positions[mint].closing is False
    assert bot.paper_balance == pytest.approx(9.95)
    assert bot.realized_pnl == 0


@pytest.mark.asyncio
async def test_unknown_submission_preserves_reservation_and_pauses(state):
    bot.OFFLINE = False
    bot.MODE_LIVE = True
    bot.executor = SimpleNamespace(
        buy=AsyncMock(side_effect=ExecutionUncertain("fixture-sig")),
        get_balance=AsyncMock(return_value=None),
        latency_dict=lambda: {},
    )
    mint, _ = await open_position(state)
    assert mint in bot.positions
    assert bot.positions[mint].execution_pending
    assert bot.TRADING_PAUSED
    assert bot.paper_balance == pytest.approx(9.95)
    assert await bot.manual_sell_position(mint) is False
    with pytest.raises(ValueError, match="unresolved"):
        await bot.handle_command({"type": "pause_trading", "paused": False}, None)


@pytest.mark.asyncio
async def test_ordinary_buy_uses_original_adaptive_parameter_resolver(state):
    bot.OFFLINE = False
    bot.MODE_LIVE = True
    bot.CONFIG.update(
        strategy_mode="adaptive", manual_tip=0.1, max_tip_sol=1, tip_pct_of_notional=1
    )
    for fee in (10_000, 10_000, 10_000):
        bot.adaptive_state.update_fees(fee)
    bot.executor = SimpleNamespace(buy=AsyncMock(return_value="fixture-signature"))
    assert await bot.live_buy_pump("fictional-mint", 0.05) == "fixture-signature"
    assert bot.executor.buy.await_args.args[3] == pytest.approx(0.00001)


@pytest.mark.asyncio
async def test_termination_failure_retains_positions_and_pauses(state):
    mint, _ = await open_position(state)
    bot.OFFLINE = False
    bot.MODE_LIVE = True
    bot.executor = SimpleNamespace(
        sell=AsyncMock(return_value=None),
        get_balance=AsyncMock(return_value=None),
        latency_dict=lambda: {},
    )
    await bot.handle_command(
        {"type": "terminate_bot"}, SimpleNamespace(send=AsyncMock())
    )
    assert bot.TRADING_PAUSED
    assert mint in bot.positions
    assert not bot.STOP_EVENT.is_set()


@pytest.mark.asyncio
async def test_stats_have_no_fabricated_latency_or_wallet_performance(state):
    await open_position(state)
    payload = await bot.stats_payload()
    json.dumps(payload, allow_nan=False)
    assert payload["chain_balance"] is None
    assert payload["actual_wallet_pnl"] is None
    assert all(value is None for value in payload["latency"].values())
    assert payload["simulated"] is True


def test_analytics_aggregates_observed_exit_events_without_invented_fees(state):
    bot.trade_history.extend(
        [
            {"reason": "TP2", "pnl_pct": 12, "pnl_sol": 1.2, "ts": 1776693600000},
            {"reason": "TP2", "pnl_pct": -4, "pnl_sol": -0.4, "ts": 1776693601000},
            {"reason": "SL", "pnl_pct": -10, "pnl_sol": -0.5, "ts": 1776697200000},
        ]
    )
    bot.realized_pnl = 0.3
    analytics = bot.analytics_payload()
    assert analytics["by_reason"]["TP2"] == {"wins": 1, "losses": 1, "avg_pnl": 4}
    assert analytics["by_reason"]["SL"] == {"wins": 0, "losses": 1, "avg_pnl": -10}
    assert analytics["by_hour"]["14"]["trades"] == 2
    assert analytics["by_hour"]["14"]["pnl"] == pytest.approx(0.8)
    assert analytics["by_hour"]["15"] == {"trades": 1, "pnl": -0.5}
    assert analytics["avg_pnl_pct"] == pytest.approx(-2 / 3)
    assert analytics["total_pnl_sol"] == 0.3
    assert analytics["win_rate"] == pytest.approx(100 / 3)
    assert analytics["total_fees_sol"] is None
    assert analytics["fees_available"] is False
    assert analytics["pnl_source"] == "strategy_estimate"
    assert analytics["sample_count"] == 3 and analytics["hour_timezone"] == "UTC"
    json.dumps(analytics, allow_nan=False)


def test_analytics_is_bounded_but_retains_full_session_total(state):
    bot.trade_history.extend(
        {"reason": "Manual", "pnl_pct": 1, "pnl_sol": 0.01, "ts": 1000000}
        for _ in range(1005)
    )
    bot.realized_pnl = 10.05
    analytics = bot.analytics_payload()
    assert analytics["sample_count"] == 1000
    assert analytics["by_reason"]["Manual"]["wins"] == 1000
    assert analytics["total_pnl_sol"] == 10.05


def test_feed_health_reports_actual_state_and_unknown_latency(state):
    first = bot.feed_health_payload()[0]
    assert not first["healthy"] and first["last_event_age_ms"] is None
    bot.feed_state.update(connected=True, last_event_ms=999000, messages=42, errors=2)
    health = bot.feed_health_payload()[0]
    assert health["name"] == "Offline synthetic feed"
    assert health["healthy"] and health["status"] == "connected"
    assert health["messages"] == 42 and health["errors"] == 2
    assert health["last_event_age_ms"] == 1000
    assert health["latency_ms"] is None
    assert "unmeasured" in health["detail"]


@pytest.mark.asyncio
async def test_mode_reset_broadcasts_empty_history_snapshot(state):
    mint, _ = await open_position(state)
    await bot.manual_sell_position(mint)
    assert bot.trade_history
    messages = []

    class Client:
        async def send(self, raw):
            messages.append(json.loads(raw))

    client = Client()
    bot.dashboard_clients.add(client)
    await bot.handle_mode_select({"mode": "paper"}, client)
    snapshots = [event["data"] for event in messages if event["type"] == "snapshot"]
    assert len(snapshots) == 1
    assert snapshots[0]["trade_history"] == []
    assert snapshots[0]["pnl"] == 0 and snapshots[0]["wins"] == 0


@pytest.mark.asyncio
async def test_offline_mode_rejects_live_and_secret_bearing_commands(
    state, monkeypatch
):
    monkeypatch.setenv("BIGAL_ENABLE_LIVE", "1")
    monkeypatch.setenv("BIGAL_PRIVATE_KEY", "never-used-fixture")
    monkeypatch.setenv("BIGAL_RPC_URL", "https://example.invalid")
    assert bot.available_modes() == ["paper"]
    ws = SimpleNamespace(send=AsyncMock())
    await bot.handle_mode_select({"mode": "legacy"}, ws)
    response = json.loads(ws.send.await_args.args[0])
    assert response["type"] == "mode_error"
    assert not bot.MODE_LIVE
    await bot.handle_mode_select(
        {"mode": "paper", "private_key": "must-not-be-accepted"}, ws
    )
    assert json.loads(ws.send.await_args.args[0])["type"] == "mode_error"


@pytest.mark.asyncio
async def test_unrecognized_commands_cannot_reach_an_executor(state):
    for command in ("create_token", "kill", "create_wallets", "generate_plan"):
        with pytest.raises(ValueError, match="Unsupported"):
            await bot.handle_command({"type": command}, None)


def test_config_validation_is_atomic_and_custom_presets_round_trip(state):
    previous = dict(bot.CONFIG)
    with pytest.raises(ValueError):
        bot.handle_config_update({"trade_size": 0.1, "max_positions": float("nan")})
    assert bot.CONFIG == previous
    bot.save_custom_preset("reviewed", {"trade_size": 0.1, "max_positions": 2})
    assert bot.apply_preset("reviewed") is True
    assert bot.CONFIG["trade_size"] == 0.1
    assert bot.delete_custom_preset("reviewed") is True
    bot.save_custom_preset("complete", None)
    assert bot.load_custom_presets()["complete"] == bot.CONFIG


@pytest.mark.asyncio
async def test_bounded_market_validation_and_price_protocol(state):
    event = list(offline_events())[1]
    assert not await bot.ingest_event({**event, "vTokensInBondingCurve": 0})
    assert not await bot.ingest_event({**event, "vSolInBondingCurve": float("inf")})
    assert not await bot.ingest_event({**event, "solAmount": -1})
    assert await bot.ingest_event(event)
    observed = bot.price_history[-1]
    assert observed["price"] == event["solAmount"] / event["tokenAmount"]
    assert observed["size"] == event["tokenAmount"]
    event.pop("tokenAmount")
    assert await bot.ingest_event(event)
    assert "size" not in bot.price_history[-1]
    assert bot.price_history[-1]["ts"] == int(state.now * 1000)
    assert bot.price_history[-1]["price_source"] == "reserve_ratio"
    assert bot.price_history[-1]["timestamp_source"] == "receipt"
    # The execution price can differ from the curve's current quoted ratio.
    assert await bot.ingest_event({**event, "solAmount": 2, "tokenAmount": 4})
    assert bot.price_history[-1]["price"] == 0.5
    assert bot.price_history[-1]["size"] == 4
    assert bot.price_history[-1]["price_source"] == "execution"


def test_offline_fixture_reproducible_and_anonymous():
    assert list(offline_events(3)) == list(offline_events(3))
    assert all("fictional" in e["traderPublicKey"] for e in offline_events())
