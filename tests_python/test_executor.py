"""Confirmation semantics with fake HTTP, signing, and RPC clients only."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from bot.executor import ExecutionUncertain, LegacyExecutor


class Transaction:
    signatures = ["fixture-signature"]

    def __init__(self, *args):
        self.message = "fixture"

    def __bytes__(self):
        return b"fictional transaction, never sent"

    @classmethod
    def from_bytes(cls, _):
        return cls()


class Response:
    status = 200

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def read(self):
        return b"fictional transaction payload"


def backend(confirmation):
    executor = object.__new__(LegacyExecutor)
    executor._keypair = SimpleNamespace(pubkey=lambda: "fictional-wallet")
    executor._aio_session = SimpleNamespace(
        closed=False, post=lambda *args, **kwargs: Response(), close=AsyncMock()
    )
    executor._VersionedTransaction = Transaction
    executor._TxOpts = lambda **kwargs: kwargs
    executor._Processed = "processed"
    executor._trade_url = "https://example.invalid"
    executor._client = SimpleNamespace(
        send_raw_transaction=AsyncMock(
            return_value=SimpleNamespace(value="fixture-signature")
        ),
        confirm_transaction=AsyncMock(return_value=confirmation),
        close=AsyncMock(),
    )
    return executor


@pytest.mark.asyncio
async def test_submission_alone_is_not_confirmation():
    executor = backend(SimpleNamespace(value=[None]))
    with pytest.raises(ExecutionUncertain):
        await executor.buy("fictional-mint", 0.05, 25, 0.001)


@pytest.mark.asyncio
async def test_explicit_chain_failure_is_not_booked():
    executor = backend(SimpleNamespace(value=[SimpleNamespace(err="rejected")]))
    assert await executor.buy("fictional-mint", 0.05, 25, 0.001) is None


@pytest.mark.asyncio
async def test_confirmation_timeout_is_uncertain_and_does_not_retry():
    executor = backend(None)
    executor._client.confirm_transaction.side_effect = TimeoutError
    with pytest.raises(ExecutionUncertain):
        await executor.sell("fictional-mint", "100%", 25, 0.001)
    executor._client.send_raw_transaction.assert_awaited_once()


@pytest.mark.asyncio
async def test_confirmed_result_returns_signature_and_resources_close():
    executor = backend(SimpleNamespace(value=[SimpleNamespace(err=None)]))
    assert await executor.buy("fictional-mint", 0.05, 25, 0.001) == "fixture-signature"
    assert executor.last_total_latency_ms >= 0
    assert executor.last_build_latency_ms is None
    await executor.close()
    executor._client.close.assert_awaited_once()
    executor._aio_session.close.assert_awaited_once()
