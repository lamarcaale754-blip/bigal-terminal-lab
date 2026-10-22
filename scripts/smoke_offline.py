"""Smoke-check the offline container's actual WebSocket protocol."""

import asyncio
import json

import websockets


async def main():
    async with websockets.connect(
        "ws://127.0.0.1:8765", origin="http://127.0.0.1:8766"
    ) as socket:
        async with asyncio.timeout(10):
            frame = json.loads(await socket.recv())
            assert frame["type"] == "snapshot"
            assert frame["data"]["mode"] == "PAPER"
            assert frame["data"]["startup_hints"]["available_modes"] == ["paper"]
            await socket.send(json.dumps({"type": "pause_trading", "paused": True}))
            while True:
                frame = json.loads(await socket.recv())
                if frame["type"] == "pause_status":
                    assert frame["data"]["paused"] is True
                    break
    print("Offline container snapshot and pause command verified.")


if __name__ == "__main__":
    asyncio.run(main())
