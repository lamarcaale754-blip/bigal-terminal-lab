"""Real loopback transport test. No external services or credentials are used."""

import asyncio
import json
import socket
from types import SimpleNamespace
from urllib.request import urlopen

import pytest
import websockets
from websockets.exceptions import InvalidStatus

from bot import bigalbot_customizable as bot


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def receive(ws, kind, predicate=lambda _: True):
    async with asyncio.timeout(5):
        while True:
            message = json.loads(await ws.recv())
            if message["type"] == kind and predicate(message["data"]):
                return message["data"]


@pytest.mark.asyncio
async def test_real_offline_transport_lifecycle(monkeypatch, tmp_path):
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "index.html").write_text(
        "<!doctype html><title>Local test build</title>", encoding="utf-8"
    )
    runtime = tmp_path / "runtime"
    monkeypatch.setattr(bot, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(bot, "DATA_DIR", runtime)
    monkeypatch.setattr(bot, "CUSTOM_PRESETS_FILE", runtime / "presets.json")
    monkeypatch.setattr(bot, "TRADE_JOURNAL_FILE", runtime / "trades.csv")
    args = SimpleNamespace(
        offline=True,
        feed="offline",
        host="127.0.0.1",
        http_port=free_port(),
        ws_port=free_port(),
        offline_interval=0.1,
    )
    task = asyncio.create_task(bot.run_bot(args))
    url = f"ws://127.0.0.1:{args.ws_port}"
    origin = f"http://127.0.0.1:{args.http_port}"
    try:
        for _ in range(100):
            try:
                ws = await websockets.connect(url, origin=origin)
                break
            except OSError:
                await asyncio.sleep(0.02)
        else:
            raise AssertionError("Local backend did not start.")
        async with ws:
            snapshot = await receive(ws, "snapshot")
            assert snapshot["mode"] == "PAPER"
            assert snapshot["startup_hints"]["available_modes"] == ["paper"]
            html = await asyncio.to_thread(
                lambda: urlopen(origin, timeout=2).read().decode()
            )
            assert "Local test build" in html
            with pytest.raises(InvalidStatus):
                async with websockets.connect(url, origin="https://example.invalid"):
                    pass
            await ws.send(
                json.dumps(
                    {"type": "config_update", "data": {"min_age": 0, "entry_buyers": 2}}
                )
            )
            assert (await receive(ws, "config"))["entry_buyers"] == 2
            await ws.send(
                json.dumps(
                    {
                        "type": "save_preset",
                        "name": "integration",
                        "data": {"entry_buyers": 3},
                    }
                )
            )
            assert (
                "integration" in (await receive(ws, "presets_update"))["custom_presets"]
            )
            entry = await receive(ws, "entry")
            await ws.send(json.dumps({"type": "pause_trading", "paused": True}))
            assert (await receive(ws, "pause_status"))["paused"] is True
            await ws.send(json.dumps({"type": "manual_sell", "mint": entry["mint"]}))
            trade = await receive(ws, "trade")
            assert trade["simulated"] is True and trade["execution_confirmed"] is False
            assert isinstance(trade["ts"], int)
            assert (await receive(ws, "manual_sell_ack"))["ok"] is True
        async with websockets.connect(url, origin=origin) as reconnect:
            snapshot = await receive(reconnect, "snapshot")
            assert len(snapshot["trade_history"]) == 1
            assert snapshot["logs"] and snapshot["price_history"]
            assert snapshot["paused"] is True
            await reconnect.send(json.dumps({"type": "terminate_bot"}))
            await receive(
                reconnect, "toast", lambda data: "shutting down" in data["message"]
            )
        await asyncio.wait_for(task, 3)
    finally:
        if not task.done():
            bot.STOP_EVENT.set()
            await asyncio.wait_for(task, 3)
