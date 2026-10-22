"""Source-derived Paper and ordinary Legacy executors. No token deployment or coordinated-wallet operations.
Live transactions require explicit backend configuration and are never used by offline mode.
"""

import time
import asyncio
from abc import ABC, abstractmethod
from typing import Optional, Dict


class ExecutionUncertain(RuntimeError):
    """Submission may have landed; preserve state and require reconciliation."""

    def __init__(self, signature=None):
        super().__init__(
            "Transaction submission is unresolved; reconcile the wallet before resuming."
        )
        self.signature = str(signature) if signature is not None else None


class ExecutorBackend(ABC):
    """Abstract interface for trade execution."""

    name: str = "base"
    last_zmq_latency_ms: Optional[float] = None
    last_build_latency_ms: Optional[float] = None
    last_land_latency_ms: Optional[float] = None
    last_total_latency_ms: Optional[float] = None

    @abstractmethod
    async def buy(
        self,
        mint: str,
        size_sol: float,
        slippage: int,
        priority_fee: float,
        keypair_b58: Optional[str] = None,
    ) -> Optional[str]:
        """Execute a buy. Returns tx signature or None on failure.
        keypair_b58 is retained for interface compatibility; Legacy uses only its configured signer."""

    @abstractmethod
    async def sell(
        self,
        mint: str,
        pct: str,
        slippage: int,
        priority_fee: float,
        keypair_b58: Optional[str] = None,
    ) -> Optional[str]:
        """Execute a sell. pct is e.g. '50%' or '100%'. Returns tx sig or None.
        keypair_b58 is retained for interface compatibility; Legacy uses only its configured signer."""

    @abstractmethod
    async def get_balance(self) -> Optional[float]:
        """Fetch wallet SOL balance."""

    @abstractmethod
    def is_connected(self) -> bool:
        """Whether the executor backend is currently reachable."""

    def latency_dict(self) -> Dict[str, float]:
        return {
            "zmq_ms": self.last_zmq_latency_ms,
            "build_ms": self.last_build_latency_ms,
            "land_ms": self.last_land_latency_ms,
            "total_ms": self.last_total_latency_ms,
        }


class PaperExecutor(ExecutorBackend):
    """Instant simulated execution for paper trading mode."""

    name = "paper"

    async def buy(self, mint, size_sol, slippage, priority_fee, keypair_b58=None):
        return "PAPER_SIM"

    async def sell(self, mint, pct, slippage, priority_fee, keypair_b58=None):
        return "PAPER_SIM"

    async def get_balance(self):
        return None

    def is_connected(self):
        return True


class LegacyExecutor(ExecutorBackend):
    """Wraps the original pumpportal_trade_async flow."""

    name = "legacy"

    def __init__(self, keypair, rpc_url, trade_url):
        from solders.transaction import VersionedTransaction
        from solana.rpc.async_api import AsyncClient
        from solana.rpc.types import TxOpts
        from solana.rpc.commitment import Processed

        self._keypair = keypair
        self._client = AsyncClient(rpc_url)
        self._trade_url = trade_url
        self._aio_session = None
        self._VersionedTransaction = VersionedTransaction
        self._TxOpts = TxOpts
        self._Processed = Processed

    async def _ensure_session(self):
        if self._aio_session is None or self._aio_session.closed:
            import aiohttp

            self._aio_session = aiohttp.ClientSession()

    async def _trade(
        self,
        action,
        mint,
        amount,
        denominated_in_sol=True,
        slippage=25,
        priority_fee=0.002,
    ):
        await self._ensure_session()
        t0 = time.monotonic()
        body = {
            "publicKey": str(self._keypair.pubkey()),
            "action": action,
            "mint": mint,
            "denominatedInSol": "true" if denominated_in_sol else "false",
            "amount": amount,
            "slippage": slippage,
            "priorityFee": priority_fee,
            "pool": "pump",
        }
        try:
            import aiohttp

            async with self._aio_session.post(
                self._trade_url, json=body, timeout=aiohttp.ClientTimeout(total=8)
            ) as resp:
                if resp.status != 200:
                    return None
                tx_bytes = await resp.read()
                if not tx_bytes:
                    return None
        except Exception as e:
            print(f"[LegacyExecutor] HTTP error: {type(e).__name__}")
            return None
        submitted = False
        sig = None
        try:
            utx = self._VersionedTransaction.from_bytes(tx_bytes)
            stx = self._VersionedTransaction(utx.message, [self._keypair])
            sig = stx.signatures[0] if getattr(stx, "signatures", None) else None
            submitted = True
            resp = await asyncio.wait_for(
                self._client.send_raw_transaction(
                    bytes(stx),
                    opts=self._TxOpts(
                        skip_preflight=True,
                        preflight_commitment=self._Processed,
                        max_retries=3,
                    ),
                ),
                timeout=10.0,
            )
            if isinstance(resp, dict):
                sig = (
                    (resp.get("result") or {}).get("value")
                    if isinstance(resp.get("result"), dict)
                    else resp.get("result")
                )
                if sig is None:
                    sig = resp.get("value")
            else:
                sig = getattr(resp, "value", None)
                if sig is None:
                    inner = getattr(resp, "result", None)
                    if inner is not None:
                        sig = getattr(inner, "value", inner)
            if sig is not None:
                confirmation = await asyncio.wait_for(
                    self._client.confirm_transaction(
                        sig, commitment="confirmed", sleep_seconds=0.5
                    ),
                    timeout=30.0,
                )
                statuses = getattr(confirmation, "value", None)
                if not statuses or statuses[0] is None:
                    raise ExecutionUncertain(sig)
                if getattr(statuses[0], "err", None) is not None:
                    return None
                self.last_total_latency_ms = (time.monotonic() - t0) * 1000
                sig_str = str(sig)
                print(f"[LegacyExecutor] TX: https://solscan.io/tx/{sig_str}")
                return sig_str
            raise ExecutionUncertain(sig)
        except ExecutionUncertain:
            raise
        except Exception as e:
            print(f"[LegacyExecutor] Sign/send error: {type(e).__name__}")
            if submitted:
                raise ExecutionUncertain(sig) from e
            return None

    async def buy(self, mint, size_sol, slippage, priority_fee, keypair_b58=None):
        return await self._trade(
            "buy",
            mint,
            size_sol,
            denominated_in_sol=True,
            slippage=slippage,
            priority_fee=priority_fee,
        )

    async def sell(self, mint, pct, slippage, priority_fee, keypair_b58=None):
        safe_pct = str(pct).strip()
        if not safe_pct.endswith("%"):
            safe_pct = f"{safe_pct}%"
        sig = await self._trade(
            "sell",
            mint,
            safe_pct,
            denominated_in_sol=False,
            slippage=slippage,
            priority_fee=priority_fee,
        )
        return sig

    async def get_balance(self):
        try:
            resp = await self._client.get_balance(self._keypair.pubkey())
            lamports = None
            if resp is None:
                return None
            if hasattr(resp, "value"):
                lamports = resp.value
            elif isinstance(resp, dict):
                lamports = (resp.get("result") or {}).get("value")
            else:
                inner = getattr(resp, "result", None)
                if inner is not None and hasattr(inner, "value"):
                    lamports = inner.value
                elif isinstance(inner, dict):
                    lamports = inner.get("value")
            if lamports is not None:
                return int(lamports) / 1000000000.0
        except Exception as e:
            print(f"[LegacyExecutor] Balance error: {type(e).__name__}")
        return None

    def is_connected(self):
        return self._keypair is not None

    async def close(self):
        if self._aio_session and (not self._aio_session.closed):
            await self._aio_session.close()
        await self._client.close()
