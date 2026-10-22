#!/usr/bin/env python3
"""BigAl terminal strategy, extracted from the latest local implementation.

Original candidate discovery, entry filters, position accounting, risk exits,
strategy modes and normal trade executors are retained. The surrounding runtime
is a local-only transport adapter with an explicit deterministic offline feed.
No private runtime files or offensive orchestration modules are included.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import csv
import importlib.util
import json
import math
import os
from pathlib import Path
import random as _random
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from typing import Optional, List, Set

import websockets
from websockets.asyncio.server import serve
from .config_defaults import CONFIG as DEFAULT_CONFIG, PRESETS, BLACKLIST_WORDS
from .executor import PaperExecutor, LegacyExecutor, ExecutionUncertain
from .strategy_mode import AdaptiveState, resolve_parameters
from .passive_features import DynamicHold, VolumeExitSignal
from .offline_feed import offline_events

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / ".runtime"
CUSTOM_PRESETS_FILE = DATA_DIR / "custom_presets.json"
TRADE_JOURNAL_FILE = DATA_DIR / "trade_journal.csv"
START_PAPER_BALANCE_SOL = 10.0
POSITION_CHECK_INTERVAL = 1.5
ENTRY_WINDOW_SEC = 10.0
SKIP_CREATOR_AS_BUYER = True
BC_GRADUATION_SOL = 85.0
MIN_NAME_LENGTH, MAX_NAME_LENGTH = 3, 40
MIN_SYMBOL_LENGTH, MAX_SYMBOL_LENGTH = 2, 10
MIN_TRADE_SIZE_SOL = 0.05
WS_URL = "wss://pumpportal.fun/api/data"
DASHBOARD_WS_PORT, HTTP_PORT = 8765, 8766


class TTLCache:
    """LRU + TTL cache. Entries expire after ttl_seconds; oldest evicted at maxsize."""

    def __init__(self, ttl_seconds: float, maxsize: int = 10000):
        from collections import OrderedDict

        self._cache: "OrderedDict[str, tuple]" = OrderedDict()
        self._ttl = ttl_seconds
        self._maxsize = maxsize

    def get(self, key, default=None):
        entry = self._cache.get(key)
        if entry is None:
            return default
        value, ts = entry
        if time.time() - ts > self._ttl:
            del self._cache[key]
            return default
        return value

    def set(self, key, value):
        self._cache[key] = (value, time.time())
        self._cache.move_to_end(key)
        if len(self._cache) > self._maxsize:
            self._cache.popitem(last=False)

    def contains(self, key) -> bool:
        return self.get(key) is not None

    def __len__(self):
        return len(self._cache)

    def prune(self) -> int:
        """Remove all expired entries. Returns count of pruned entries."""
        now = time.time()
        expired = [k for k, (v, ts) in self._cache.items() if now - ts > self._ttl]
        for k in expired:
            del self._cache[k]
        return len(expired)


@dataclass
class Position:
    mint: str
    name: str
    symbol: str
    size_sol: float
    entry_price: float
    entry_value_sol: float
    entry_time: float
    entry_vsol: float
    last_price: float
    max_price: float
    last_vsol: float
    creator: str = ""
    partial_sold: bool = False
    remaining_size_sol: float = 0.0
    is_moonbag: bool = False
    buy_tx_sig: Optional[str] = None
    last_update_time: float = 0.0
    prev_price: float = 0.0
    closing: bool = False
    execution_pending: bool = False
    custom_max_hold: float = 0.0
    bot_trail_override_pct: float = 0.0
    bot_trail_anchor_price: float = 0.0

    def __post_init__(self):
        if self.remaining_size_sol == 0.0:
            self.remaining_size_sol = self.size_sol
        if self.last_update_time == 0.0:
            self.last_update_time = self.entry_time
        if self.prev_price == 0.0:
            self.prev_price = self.entry_price

    def to_dict(self):
        pnl = (
            (self.last_price / self.entry_price - 1.0) * 100.0
            if self.entry_price > 0
            else 0
        )
        hold = time.time() - self.entry_time
        return {
            "mint": self.mint,
            "name": self.name,
            "symbol": self.symbol,
            "size_sol": round(self.remaining_size_sol, 4),
            "pnl_pct": round(pnl, 2),
            "hold_time": round(hold, 1),
            "partial_sold": self.partial_sold,
            "is_moonbag": self.is_moonbag,
            "closing": self.closing,
            "execution_pending": self.execution_pending,
            "entry_price": self.entry_price,
            "last_price": self.last_price,
        }


@dataclass
class Candidate:
    mint: str
    name: str
    symbol: str
    creator: str
    created_at: float
    initial_vsol: float
    initial_vtokens: float
    initial_price: float
    last_vsol: float
    last_vtokens: float = 0.0
    unique_buyers: Set[str] = field(default_factory=set)
    buy_events: List[tuple] = field(default_factory=list)
    sell_events: List[tuple] = field(default_factory=list)

    def bc_progress(self):
        denom = BC_GRADUATION_SOL - self.initial_vsol
        if denom <= 0:
            return 100.0
        return max(0.0, (self.last_vsol - self.initial_vsol) / denom * 100.0)


async def manual_sell_position(mint):
    global positions, moonbags, paper_balance, realized_pnl, wins, losses
    global consecutive_losses, trade_history
    pos = positions.get(mint) or moonbags.get(mint)
    if not pos:
        for m, p in list(positions.items()):
            if m.startswith(mint) or m[:12] == mint:
                pos = p
                mint = m
                break
        if not pos:
            for m, p in list(moonbags.items()):
                if m.startswith(mint) or m[:12] == mint:
                    pos = p
                    mint = m
                    break
    if not pos:
        print(f"⚠ Manual sell: mint {mint[:12]} not found")
        await broadcast_log(
            f"⚠ Manual sell failed: position {mint[:12]} not found", "warn"
        )
        await broadcast_stats(force=True)
        return False
    is_mb = pos.is_moonbag
    if pos.execution_pending:
        await broadcast_log(
            "Position has an unresolved transaction. Reconcile the wallet before another order.",
            "warn",
        )
        return False
    source = moonbags if is_mb else positions
    async with state_lock:
        if mint not in source or pos.closing:
            print(f"  Manual sell: {mint[:12]} already closing")
            return False
        pos.closing = True
    now = time.time()
    active = pos.remaining_size_sol
    pnl_pct = (
        (pos.last_price / pos.entry_price - 1.0) * 100.0 if pos.entry_price > 0 else 0
    )
    pnl_sol = active * (pnl_pct / 100.0)
    hold = now - pos.entry_time
    sell_ok = True
    if MODE_LIVE:
        sell_ok = await live_sell_pump(mint, "100%", "Manual", pnl_pct)
        if not sell_ok:
            async with state_lock:
                if mint in source:
                    source[mint].closing = False
            if await _maybe_log_sell_cooldown(mint, pos.name, pos.symbol, "Manual"):
                return
            _bump_counter("sell_failed_chain")
            msg = f"⚠ Manual sell failed on-chain for {pos.name} ({pos.symbol}); position kept open"
            print(msg)
            await broadcast_log(msg, "warn")
            return False
    realized_pnl += pnl_sol
    if pnl_sol >= 0:
        wins += 1
        consecutive_losses = 0
    else:
        losses += 1
        consecutive_losses += 1
    paper_balance += max(active + pnl_sol, 0.0)
    log_trade(
        pos.entry_time,
        now,
        mint,
        pos.name,
        pos.symbol,
        pos.creator,
        "SELL",
        active,
        pos.entry_price,
        pos.last_price,
        pnl_sol,
        pnl_pct,
        "Manual",
    )
    tag = " [MB]" if is_mb else ""
    log_msg = f"🔴 MANUAL SELL {pos.name} ({pos.symbol}){tag} | PnL: {pnl_pct:+.1f}% | Hold: {hold:.1f}s"
    print(log_msg)
    level = "exit-win" if pnl_sol >= 0 else "exit-loss"
    await broadcast_log(log_msg, level)
    confirm_mark = "✅" if MODE_LIVE and sell_ok else ""
    trade_history.append(
        {
            "time": datetime.now().strftime("%H:%M:%S"),
            "timestamp": now * 1000,
            "mint": mint,
            "action": "sell",
            "name": f"{pos.name} {confirm_mark}".strip(),
            "symbol": pos.symbol,
            "pnl_pct": round(pnl_pct, 2),
            "pnl_sol": round(pnl_sol, 6),
            "projected_pnl_sol": round(pnl_sol, 6),
            "execution_confirmed": bool(MODE_LIVE and sell_ok),
            "simulated": not MODE_LIVE,
            "confirmation_mark": confirm_mark,
            "cum_pnl": round(realized_pnl, 6),
            "balance": round(paper_balance, 4),
            "hold_time": round(hold, 1),
            "reason": "Manual",
        }
    )
    if _tracks_live_wallet():
        wsnap = await wallet_chain_snapshot(force_rpc=True)
        trade_history[-1]["actual_wallet_pnl"] = _actual_wallet_pnl_from_snapshot(wsnap)
    await send_to_dashboard({"type": "trade", "data": trade_history[-1]})
    if MODE_LIVE:
        pass
    source.pop(mint, None)
    print(f"✅ Closed {pos.name} | Bal: {paper_balance:.4f} | W/L: {wins}/{losses}")
    await broadcast_log(
        f"✅ Manual closed {pos.name} | Bal: {paper_balance:.4f}", level
    )
    await broadcast_stats()
    return True


def _actual_wallet_pnl_from_snapshot(wsnap: dict) -> Optional[float]:
    wallet_delta = wsnap.get("wallet_delta_sol")
    return round(wallet_delta, 6) if wallet_delta is not None else None


def _bump_counter(key: str) -> None:
    execution_counters[key] = execution_counters.get(key, 0) + 1
    now = time.time()
    if key == "buy_failed_chain":
        _recent_buy_fail_ts.append(now)
    elif key == "sell_failed_chain":
        _recent_sell_fail_ts.append(now)


async def _maybe_trip_safety_pause() -> None:
    global TRADING_PAUSED, cooldown_until
    if TRADING_PAUSED or not MODE_LIVE:
        return
    now = time.time()
    window = max(10.0, float(CONFIG.get("auto_pause_fail_window_sec", 120.0) or 120.0))
    while _recent_buy_fail_ts and now - _recent_buy_fail_ts[0] > window:
        _recent_buy_fail_ts.popleft()
    while _recent_sell_fail_ts and now - _recent_sell_fail_ts[0] > window:
        _recent_sell_fail_ts.popleft()
    buy_cap = int(CONFIG.get("auto_pause_max_buy_failures", 4) or 4)
    sell_cap = int(CONFIG.get("auto_pause_max_sell_failures", 5) or 5)
    hit_fail_storm = (
        len(_recent_buy_fail_ts) >= buy_cap or len(_recent_sell_fail_ts) >= sell_cap
    )
    hit_wallet_floor = False
    wsnap = await wallet_chain_snapshot()
    wallet_delta = wsnap.get("wallet_delta_sol")
    if wallet_delta is not None:
        floor = float(CONFIG.get("auto_pause_wallet_pnl_floor", -0.08) or -0.08)
        hit_wallet_floor = wallet_delta <= floor
    if not (hit_fail_storm or hit_wallet_floor):
        return
    TRADING_PAUSED = True
    cooldown_until = now + max(30.0, float(CONFIG.get("cooldown_sec", 10.0) or 10.0))
    reason = []
    if hit_fail_storm:
        reason.append(
            f"fail storm (buy_fails={len(_recent_buy_fail_ts)}, sell_fails={len(_recent_sell_fail_ts)})"
        )
    if hit_wallet_floor:
        reason.append(f"wallet_pnl_floor ({wallet_delta:+.4f} SOL)")
    msg = f"🛑 Safety auto-pause triggered: {', '.join(reason)}"
    print(msg)
    await broadcast_log(msg, "warn")
    await send_to_dashboard({"type": "pause_status", "data": {"paused": True}})


async def wallet_chain_snapshot(force_rpc: bool = False) -> dict:
    """Cached RPC wallet balance — only calls RPC every WALLET_SNAPSHOT_TTL_SEC (default 5s).
    Trade-event broadcasts use the cache; the ticker forces a refresh."""
    global _wallet_snapshot_cache, _wallet_snapshot_ts
    now = time.time()
    if not force_rpc and now - _wallet_snapshot_ts < _WALLET_SNAPSHOT_TTL:
        return _wallet_snapshot_cache
    track = _tracks_live_wallet()
    if not track:
        _wallet_snapshot_cache = {
            "chain_balance": None,
            "wallet_delta_sol": None,
            "session_wallet_baseline": None,
        }
        return _wallet_snapshot_cache
    bal = await get_live_balance()
    baseline = session_wallet_start_sol
    dlt = None
    if bal is not None and baseline is not None:
        dlt = bal - baseline
    _wallet_snapshot_cache = {
        "chain_balance": round(bal, 6) if bal is not None else None,
        "wallet_delta_sol": round(dlt, 6) if dlt is not None else None,
        "session_wallet_baseline": round(baseline, 6) if baseline is not None else None,
    }
    _wallet_snapshot_ts = now
    return _wallet_snapshot_cache


def is_blacklisted(name, symbol):
    lower = (name or "").lower() + " " + (symbol or "").lower()
    return any((w in lower for w in BLACKLIST_WORDS))


def is_name_quality(name, symbol):
    n = (name or "").strip()
    s = (symbol or "").strip()
    if len(n) < MIN_NAME_LENGTH or len(n) > MAX_NAME_LENGTH:
        return False
    if len(s) < MIN_SYMBOL_LENGTH or len(s) > MAX_SYMBOL_LENGTH:
        return False
    if n.isupper() and len(n) > 10:
        return False
    return True


def _should_skip_live_sell(
    sell_size_sol: float, pnl_pct: float, reason: str, is_tp1: bool = False
) -> bool:
    """Guard against dust exits where expected proceeds are below fee floor."""
    if not MODE_LIVE:
        return False
    upper_reason = (reason or "").upper()
    est_out = sell_size_sol + sell_size_sol * (pnl_pct / 100.0)
    min_key = "min_live_tp1_exit_sol" if is_tp1 else "min_live_exit_sol"
    min_out = float(CONFIG.get(min_key, 0.0) or 0.0)
    force_skip = bool(CONFIG.get("force_skip_micro_sells", True))
    if not force_skip and any(
        (
            k in upper_reason
            for k in ("RUG", "SL", "VELOCITY", "STALE", "EMERGENCY", "DEVDUMP")
        )
    ):
        return False
    return est_out > 0 and est_out < min_out


def _fee_capped_tip_sol(requested_tip_sol: float, notional_sol: float) -> float:
    """Cap priority fee by absolute max and notional percentage."""
    tip = max(0.0, float(requested_tip_sol or 0.0))
    cap_abs = max(0.0, float(CONFIG.get("max_tip_sol", tip) or 0.0))
    pct = max(0.0, float(CONFIG.get("tip_pct_of_notional", 0.0) or 0.0))
    cap_notional = notional_sol * pct if notional_sol > 0 and pct > 0 else cap_abs
    cap = min(cap_abs, cap_notional) if cap_notional > 0 else cap_abs
    if cap > 0:
        tip = min(tip, cap)
    return max(0.0, tip)


def _is_emergency_exit(reason: str, pnl_pct: Optional[float]) -> bool:
    r = (reason or "").upper()
    if any(
        (k in r for k in ("RUG", "SL", "VELOCITY", "STALE", "DEVDUMP", "EMERGENCY"))
    ):
        return True
    try:
        floor = float(CONFIG.get("emergency_tip_pnl_pct", -15.0) or -15.0)
        if pnl_pct is not None and float(pnl_pct) <= floor:
            return True
    except Exception:
        pass
    return False


def _sell_tip_sol(
    requested_tip_sol: float, notional_sol: float, reason: str, pnl_pct: Optional[float]
) -> float:
    tip = _fee_capped_tip_sol(requested_tip_sol, notional_sol)
    if not bool(CONFIG.get("emergency_tip_enabled", True)):
        return tip
    if _is_emergency_exit(reason, pnl_pct):
        floor = max(0.0, float(CONFIG.get("emergency_tip_floor_sol", 0.001) or 0.0))
        return max(tip, floor)
    return tip


async def position_monitor():
    global positions, moonbags, paper_balance, realized_pnl, wins, losses
    global consecutive_losses, cooldown_until, trade_history
    while True:
        has_open_positions = bool(positions or moonbags)
        poll_interval = 1.0 if has_open_positions else POSITION_CHECK_INTERVAL
        await asyncio.sleep(poll_interval)
        now = time.time()
        to_close = []
        await _maybe_trip_safety_pause()
        if MODE_LIVE and positions:
            externally_closed = []
            for mint, pos in list(positions.items()):
                if pos.closing:
                    continue
                if now - pos.entry_time < float(
                    CONFIG.get("external_close_grace_sec", 25.0) or 25.0
                ):
                    continue
                if not pos.buy_tx_sig:
                    continue
                bal_raw = await _wallet_token_balance_for_mint(mint)
                if bal_raw == 0:
                    externally_closed.append((mint, pos))
            for mint, pos in externally_closed:
                async with state_lock:
                    if mint not in positions:
                        continue
                    positions.pop(mint, None)
                msg = f"🔄 Synced external close for {pos.name} ({pos.symbol}) — removed local position"
                print(msg)
                await broadcast_log(msg, "warn")
                await broadcast_stats()
        for mint, pos in list(positions.items()):
            if pos.closing or pos.execution_pending:
                continue
            hold = now - pos.entry_time
            pnl = (
                (pos.last_price / pos.entry_price - 1.0) * 100.0
                if pos.entry_price > 0
                else 0
            )
            exit_grace = float(CONFIG.get("exit_grace_sec", 8.0) or 8.0)
            in_exit_grace = hold < exit_grace
            max_hold_for_pos = float(CONFIG["max_hold"])
            if (
                bool(CONFIG.get("dynamic_hold_enabled", True))
                and pos.custom_max_hold > 0
            ):
                max_hold_for_pos = pos.custom_max_hold
            if in_exit_grace:
                if pos.entry_vsol > 0 and pos.last_vsol > 0:
                    rug = (pos.last_vsol / pos.entry_vsol - 1.0) * 100.0
                    if (
                        rug <= -CONFIG["rug_drop"]
                        or pos.last_vsol < CONFIG["rug_min_vsol"]
                    ):
                        to_close.append((mint, pos, pnl, hold, "RUG (monitor)"))
                continue
            if hold >= max_hold_for_pos:
                to_close.append((mint, pos, pnl, hold, "Time (monitor)"))
            elif pnl <= -CONFIG["sl"]:
                to_close.append((mint, pos, pnl, hold, "SL (monitor)"))
            elif pos.entry_vsol > 0 and pos.last_vsol > 0:
                rug = (pos.last_vsol / pos.entry_vsol - 1.0) * 100.0
                if rug <= -CONFIG["rug_drop"] or pos.last_vsol < CONFIG["rug_min_vsol"]:
                    to_close.append((mint, pos, pnl, hold, "RUG (monitor)"))
            if (
                bool(CONFIG.get("volume_exit_enabled", True))
                and volume_signal is not None
            ):
                spike, rate = volume_signal.is_spike(mint)
                if spike:
                    to_close.append(
                        (mint, pos, pnl, hold, f"VolumeSpike ({rate:.3f}/s)")
                    )
            stale = now - pos.last_update_time > 10.0
            if stale and pnl < -5.0:
                to_close.append((mint, pos, pnl, hold, "STALE (no updates)"))
        for mint, mb in list(moonbags.items()):
            if mb.closing or mb.execution_pending:
                continue
            hold = now - mb.entry_time
            pnl = (
                (mb.last_price / mb.entry_price - 1.0) * 100.0
                if mb.entry_price > 0
                else 0
            )
            peak_pnl = (
                (mb.max_price / mb.entry_price - 1.0) * 100.0
                if mb.entry_price > 0
                else 0
            )
            if hold >= CONFIG["moonbag_expire"]:
                to_close.append((mint, mb, pnl, hold, "Moonbag expire"))
            elif pnl <= -CONFIG["moonbag_sl"]:
                to_close.append((mint, mb, pnl, hold, "Moonbag SL"))
            elif peak_pnl > 0 and mb.last_price <= mb.max_price * (
                1.0 - CONFIG["moonbag_trail"] / 100.0
            ):
                to_close.append((mint, mb, pnl, hold, "Moonbag trail"))
        for mint, pos, pnl_pct, hold, reason in to_close:
            is_mb = pos.is_moonbag
            source = moonbags if is_mb else positions
            async with state_lock:
                if mint not in source or pos.closing:
                    continue
                pos.closing = True
            active = pos.remaining_size_sol
            pnl_sol = active * (pnl_pct / 100.0)
            is_profitable = pnl_sol >= 0
            mb_pct = (
                0.0
                if bool(CONFIG.get("force_full_exit", True))
                else CONFIG["moonbag_pct"]
            )
            should_moonbag = (
                not is_mb and is_profitable and (mb_pct > 0) and ("RUG" not in reason)
            )
            sell_pct = 100 - mb_pct if should_moonbag else 100
            sell_size = active * (sell_pct / 100.0)
            moonbag_size = active - sell_size if should_moonbag else 0
            sell_ok = True
            if MODE_LIVE:
                if _should_skip_live_sell(sell_size, pnl_pct, reason):
                    async with state_lock:
                        if mint in source:
                            source[mint].closing = False
                    warn = f"🪙 EXIT SKIPPED (dust) for {pos.name} ({pos.symbol}) | {reason} | estimated output below fee floor"
                    print(warn)
                    await broadcast_log(warn, "warn")
                    continue
                sell_str = f"{sell_pct}%" if sell_pct < 100 else "100%"
                sell_ok = await live_sell_pump(mint, sell_str, reason, pnl_pct)
                if not sell_ok:
                    async with state_lock:
                        if mint in source:
                            source[mint].closing = False
                    if await _maybe_log_sell_cooldown(
                        mint, pos.name, pos.symbol, reason
                    ):
                        continue
                    _bump_counter("sell_failed_chain")
                    warn = f"⚠ EXIT FAILED on-chain for {pos.name} ({pos.symbol}) | {reason} | keeping position open"
                    print(warn)
                    await broadcast_log(warn, "warn")
                    continue
            realized_pnl += sell_size * (pnl_pct / 100.0)
            if is_profitable:
                wins += 1
                consecutive_losses = 0
            else:
                losses += 1
                consecutive_losses += 1
                if pos.creator and pnl_pct <= -CONFIG["sl"]:
                    add_to_creator_blacklist(pos.creator, pos.name)
                if consecutive_losses >= CONFIG["cooldown_losses"]:
                    cooldown_until = now + CONFIG["cooldown_sec"]
            exit_value = sell_size + sell_size * (pnl_pct / 100.0)
            paper_balance += max(exit_value, 0.0)
            log_trade(
                pos.entry_time,
                now,
                mint,
                pos.name,
                pos.symbol,
                pos.creator,
                "SELL",
                sell_size,
                pos.entry_price,
                pos.last_price,
                sell_size * (pnl_pct / 100.0),
                pnl_pct,
                reason,
            )
            mb_note = f" | 🌙 keeping {mb_pct:.0f}% moonbag" if should_moonbag else ""
            log_msg = f"🔔 EXIT {pos.name} ({pos.symbol}) – {reason} | PnL: {pnl_pct:+.1f}% | Hold: {hold:.1f}s{mb_note}"
            print(log_msg)
            level = "exit-win" if is_profitable else "exit-loss"
            await broadcast_log(log_msg, level)
            confirm_mark = "✅" if MODE_LIVE and sell_ok else ""
            trade_history.append(
                {
                    "time": datetime.now().strftime("%H:%M:%S"),
                    "timestamp": now * 1000,
                    "mint": mint,
                    "action": "sell",
                    "name": f"{pos.name} {confirm_mark}".strip(),
                    "symbol": pos.symbol,
                    "pnl_pct": round(pnl_pct, 2),
                    "pnl_sol": round(sell_size * (pnl_pct / 100.0), 6),
                    "projected_pnl_sol": round(sell_size * (pnl_pct / 100.0), 6),
                    "execution_confirmed": bool(MODE_LIVE and sell_ok),
                    "simulated": not MODE_LIVE,
                    "confirmation_mark": confirm_mark,
                    "cum_pnl": round(realized_pnl, 6),
                    "balance": round(paper_balance, 4),
                    "hold_time": round(hold, 1),
                    "reason": reason + (" 🌙" if should_moonbag else ""),
                }
            )
            if _tracks_live_wallet():
                wsnap = await wallet_chain_snapshot(force_rpc=True)
                trade_history[-1]["actual_wallet_pnl"] = (
                    _actual_wallet_pnl_from_snapshot(wsnap)
                )
            await send_to_dashboard({"type": "trade", "data": trade_history[-1]})
            if MODE_LIVE:
                pass
            source.pop(mint, None)
            if should_moonbag and moonbag_size > 0:
                moonbags[mint] = Position(
                    mint=mint,
                    name=pos.name,
                    symbol=pos.symbol,
                    size_sol=moonbag_size,
                    entry_price=pos.entry_price,
                    entry_value_sol=moonbag_size,
                    entry_time=pos.entry_time,
                    entry_vsol=pos.entry_vsol,
                    last_price=pos.last_price,
                    max_price=pos.max_price,
                    last_vsol=pos.last_vsol,
                    creator=pos.creator,
                    is_moonbag=True,
                    remaining_size_sol=moonbag_size,
                    last_update_time=now,
                )
                print(f"🌙 Moonbag created: {pos.name} ({moonbag_size:.4f} SOL)")
            print(
                f"✅ Closed {pos.name} | Bal: {paper_balance:.4f} | W/L: {wins}/{losses}"
            )
            await broadcast_log(
                f"✅ Closed {pos.name} | Bal: {paper_balance:.4f}", level
            )
        if positions or moonbags or candidates or to_close:
            await broadcast_stats(force=positions or moonbags)


async def handle_new_token(msg, ws):
    global candidates, subscribed_trades
    mint = msg.get("mint")
    if not mint:
        return
    if msg.get("txType") != "create":
        return
    if not _create_log_dedup.contains(mint):
        _create_log_dedup.set(mint, True)
        name0 = msg.get("name", "Unknown")
        symbol0 = msg.get("symbol", "???")
        try:
            vsol0 = float(msg.get("vSolInBondingCurve", 0) or 0.0)
        except Exception:
            vsol0 = 0.0
        log_msg0 = f"🆕 {name0} ({symbol0}) | vSOL: {vsol0:.2f}"
        print(log_msg0)
        await broadcast_log(log_msg0, "info")
    if mint in candidates or mint in positions or mint in moonbags:
        return
    name = msg.get("name", "Unknown")
    symbol = msg.get("symbol", "???")
    if is_blacklisted(name, symbol):
        print(f"  ❌ blacklisted: {name}")
        return
    if not is_name_quality(name, symbol):
        print(f"  ❌ name quality fail: {name}")
        return
    now = time.time()
    name_key = name.strip().lower()
    if seen_names.contains(name_key):
        return
    seen_names.set(name_key, True)
    creator = msg.get("traderPublicKey") or msg.get("user") or msg.get("owner") or ""
    if creator and creator in creator_blacklist:
        return
    try:
        vsol = float(msg.get("vSolInBondingCurve", 0))
        vtokens = float(msg.get("vTokensInBondingCurve", 0))
    except Exception:
        return
    if vsol > 0:
        adaptive_state.update_liquidity(vsol)
        adaptive_state.update_vsol_slope(vsol, now)
    params = resolve_parameters(CONFIG, adaptive_state)
    if vsol < params["min_liquidity"] or vtokens <= 0:
        return
    candidates[mint] = Candidate(
        mint=mint,
        name=name,
        symbol=symbol,
        creator=creator,
        created_at=now,
        initial_vsol=vsol,
        initial_vtokens=vtokens,
        initial_price=vsol / vtokens,
        last_vsol=vsol,
        last_vtokens=vtokens,
    )
    if mint not in subscribed_trades and ws is not None:
        await ws.send(json.dumps({"method": "subscribeTokenTrade", "keys": [mint]}))
        subscribed_trades[mint] = True
        print(f"🎯 SUBSCRIBED to trades: {name} ({symbol}) | mint={mint[:12]}...")
        await broadcast_log(f"🎯 Tracking {name} ({symbol})", "info")
    await broadcast_stats()


async def maybe_open_from_candidate(mint, msg):
    global candidates, positions, paper_balance, cooldown_until
    cand = candidates.get(mint)
    if not cand:
        return
    now = time.time()
    blocked_until = _blocked_buy_mints_until.get(mint, 0.0)
    if blocked_until > now:
        return
    if now < cooldown_until:
        _bump_counter("skip_cooldown")
        return
    if TRADING_PAUSED:
        _bump_counter("skip_paused")
        return
    try:
        vsol = float(msg.get("vSolInBondingCurve", 0))
        vtokens = float(msg.get("vTokensInBondingCurve", 0))
        if vsol <= 0 or vtokens <= 0:
            return
        price = vsol / vtokens
    except Exception:
        return
    if now - cand.created_at > CONFIG["candidate_age"]:
        candidates.pop(mint, None)
        return
    tx_type = msg.get("txType")
    trader = (
        msg.get("traderPublicKey") or msg.get("user") or msg.get("owner") or "unknown"
    )
    sol_amount = 0.0
    try:
        sol_amount = float(msg.get("solAmount", 0) or 0)
    except Exception:
        pass
    if sol_amount <= 0:
        sol_amount = abs(vsol - cand.last_vsol)
    cand.last_vsol = vsol
    cand.last_vtokens = vtokens
    if tx_type == "buy":
        if SKIP_CREATOR_AS_BUYER and trader == cand.creator and cand.creator:
            _bump_counter("skip_creator_buyer")
            return
        cand.unique_buyers.add(str(trader))
        if sol_amount > 0:
            cand.buy_events.append((now, sol_amount))
    elif tx_type == "sell":
        if sol_amount > 0:
            cand.sell_events.append((now, sol_amount))
    cutoff = now - ENTRY_WINDOW_SEC
    cand.buy_events = [(t, s) for t, s in cand.buy_events if t >= cutoff]
    cand.sell_events = [(t, s) for t, s in cand.sell_events if t >= cutoff]
    buy_vol = sum((s for _, s in cand.buy_events))
    sell_vol = sum((s for _, s in cand.sell_events))
    total = buy_vol + sell_vol
    net = buy_vol - sell_vol
    sr = sell_vol / total if total > 0 else 0
    buyers = len(cand.unique_buyers)
    bc_prog = cand.bc_progress()
    min_buyers = int(CONFIG["entry_buyers"])
    min_entry_vol = float(CONFIG["entry_vol"])
    if tx_type == "buy":
        print(
            f"👤 {cand.name} ({cand.symbol}) buyers={buyers}/{min_buyers} vol={buy_vol:.2f} sell%={sr:.0%} BC={bc_prog:.1f}%"
        )
        await broadcast_log(
            f"👤 {cand.name} ({cand.symbol}) buyers={buyers}/{min_buyers} vol={buy_vol:.2f} sell%={sr:.0%} BC={bc_prog:.1f}%",
            "info",
        )
    await broadcast_stats()
    strat_params = resolve_parameters(CONFIG, adaptive_state)
    if vsol < strat_params["min_liquidity"]:
        _bump_counter("skip_low_liquidity")
        return
    pump = (price / cand.initial_price - 1.0) * 100.0
    if pump > CONFIG["max_pump"]:
        _bump_counter("skip_overpump")
        candidates.pop(mint, None)
        return
    if bc_prog < strat_params["entry_progress"]:
        _bump_counter("skip_progress_window")
        return
    if bc_prog > CONFIG["bc_max"]:
        _bump_counter("skip_progress_window")
        candidates.pop(mint, None)
        return
    if sr > CONFIG["sell_ratio"] or net < CONFIG["net_buy"]:
        _bump_counter("skip_orderflow")
        return
    age = now - cand.created_at
    if age < CONFIG["min_age"]:
        _bump_counter("skip_too_early")
        return
    intel_score = 0.0
    if intel_score >= 25:
        min_entry_vol = max(0.2, min_entry_vol * 0.85)
    elif intel_score <= -10:
        min_entry_vol = min_entry_vol * 1.15
    entry_score = float(intel_score)
    trade_size = CONFIG["trade_size"]
    if MODE_LIVE and trade_size < MIN_TRADE_SIZE_SOL:
        trade_size = MIN_TRADE_SIZE_SOL
    if buyers >= min_buyers and buy_vol >= min_entry_vol and (mint not in positions):
        async with state_lock:
            if mint in positions or mint in moonbags:
                return
            if (
                len(positions) >= int(CONFIG["max_positions"])
                or paper_balance < trade_size
            ):
                _bump_counter("skip_capacity_or_balance")
                return
            if CONFIG["anti_manip"]:
                buy_amounts = [s for _, s in cand.buy_events]
                if len(buy_amounts) >= 2:
                    unique_amounts = len(set((round(a, 4) for a in buy_amounts)))
                    diversity = unique_amounts / len(buy_amounts)
                    if diversity < CONFIG["min_wallet_diversity"]:
                        _bump_counter("skip_anti_manip_diversity")
                        print(
                            f"🛡 SKIP {cand.name} — fake volume (diversity={diversity:.2f})"
                        )
                        return
                buyer_list = list(cand.unique_buyers)
                max_repeats = int(CONFIG["max_repeat_wallets"])
                for wallet in buyer_list:
                    count = recent_entry_wallets.get(wallet, 0)
                    if count is not None and count >= max_repeats:
                        _bump_counter("skip_anti_manip_repeat_wallet")
                        print(f"🛡 SKIP {cand.name} — repeat wallet {wallet[:8]}...")
                        return
                skip_pct = CONFIG["random_skip_pct"]
                if skip_pct > 0 and random.randint(1, 100) <= skip_pct:
                    _bump_counter("skip_randomized")
                    print(f"🎲 Random skip: {cand.name} (anti-snipe)")
                    return
                for wallet in buyer_list:
                    prev = recent_entry_wallets.get(wallet, 0) or 0
                    recent_entry_wallets.set(wallet, prev + 1)
            pos = Position(
                mint=mint,
                name=cand.name,
                symbol=cand.symbol,
                size_sol=trade_size,
                entry_price=price,
                entry_value_sol=trade_size,
                entry_time=now,
                entry_vsol=vsol,
                last_price=price,
                max_price=price,
                last_vsol=vsol,
                creator=cand.creator,
            )
            if (
                bool(CONFIG.get("dynamic_hold_enabled", True))
                and dynamic_hold is not None
            ):
                pos.custom_max_hold = dynamic_hold.calc(buyers, buy_vol, entry_score)
            paper_balance -= trade_size
            positions[mint] = pos
            _entry_signal_wallet_by_mint[mint] = str(trader or "")
        log_msg = f"🟢 ENTRY {cand.name} ({cand.symbol}) | {buyers} buyers | {buy_vol:.2f} SOL | pump={pump:.1f}% | BC={bc_prog:.1f}% | age={age:.1f}s"
        print(log_msg)
        await broadcast_log(log_msg, "entry")
        await broadcast_stats(force=True)
        await send_to_dashboard(
            {
                "type": "entry",
                "data": {
                    "name": cand.name,
                    "symbol": cand.symbol,
                    "mint": mint,
                    "size": trade_size,
                    "buyers": buyers,
                    "pump_pct": round(pump, 1),
                    "bc_progress": round(bc_prog, 1),
                },
            }
        )
        if MODE_LIVE:
            pos.execution_pending = True
            try:
                sig = await live_buy_pump(mint, trade_size)
            except ExecutionUncertain:
                await mark_execution_uncertain(pos)
                return
            pos.execution_pending = False
            if sig is None:
                _bump_counter("buy_failed_chain")
                try:
                    last_buy_err = str(
                        getattr(executor, "last_buy_error")() or ""
                    ).lower()
                except Exception:
                    last_buy_err = ""
                if any(
                    (
                        k in last_buy_err
                        for k in ("6000", "not authorized", "unauthorized")
                    )
                ):
                    block_sec = float(
                        CONFIG.get("buy_block_after_6000_sec", 180.0) or 180.0
                    )
                    _blocked_buy_mints_until[mint] = time.time() + max(30.0, block_sec)
                paper_balance += trade_size
                positions.pop(mint, None)
                warn = f"⚠ BUY failed on-chain for {cand.name} ({cand.symbol}) | entry skipped"
                print(warn)
                await broadcast_log(warn, "warn")
                await _maybe_trip_safety_pause()
                return
            pos.buy_tx_sig = sig
            _blocked_buy_mints_until.pop(mint, None)
        candidates.pop(mint, None)
        await broadcast_stats()


async def handle_trade_event(msg):
    global positions, moonbags, paper_balance, realized_pnl, wins, losses
    global consecutive_losses, cooldown_until, trade_history
    mint = msg.get("mint")
    if not mint:
        return
    now_t = time.time()
    if mint in candidates and mint not in positions:
        await maybe_open_from_candidate(mint, msg)
        if mint not in positions:
            return
    if mint in moonbags:
        try:
            mb = moonbags[mint]
            vsol = float(msg.get("vSolInBondingCurve", 0))
            vtokens = float(msg.get("vTokensInBondingCurve", 0))
            if vsol > 0 and vtokens > 0:
                price_mb = vsol / vtokens
                old_price_mb = mb.last_price
                mb.last_price = price_mb
                mb.last_vsol = vsol
                mb.last_update_time = time.time()
                if price_mb > mb.max_price:
                    mb.max_price = price_mb
                if mb.closing or mb.execution_pending:
                    pass
                else:
                    mb_pnl = (
                        (price_mb / mb.entry_price - 1.0) * 100.0
                        if mb.entry_price > 0
                        else 0
                    )
                    mb_hold = time.time() - mb.entry_time
                    mb_reason = None
                    if mb_pnl <= -CONFIG["moonbag_sl"]:
                        mb_reason = "Moonbag SL"
                    elif mb.max_price > mb.entry_price:
                        mb_peak = (mb.max_price / mb.entry_price - 1.0) * 100.0
                        if mb_peak > 0 and price_mb <= mb.max_price * (
                            1.0 - CONFIG["moonbag_trail"] / 100.0
                        ):
                            mb_reason = "Moonbag trail"
                    elif CONFIG["velocity_check"] and old_price_mb > 0:
                        mb_tick = (price_mb / old_price_mb - 1.0) * 100.0
                        if mb_tick <= -CONFIG["velocity_drop"]:
                            mb_reason = "Moonbag velocity"
                    elif mb_hold >= CONFIG["moonbag_expire"]:
                        mb_reason = "Moonbag expire"
                    if mb_reason:
                        mb.closing = True
                        active_mb = mb.remaining_size_sol
                        pnl_sol_mb = active_mb * (mb_pnl / 100.0)
                        sell_ok = True
                        if MODE_LIVE:
                            sell_ok = await live_sell_pump(
                                mint, "100%", mb_reason or "Moonbag", mb_pnl
                            )
                            if not sell_ok:
                                mb.closing = False
                                if await _maybe_log_sell_cooldown(
                                    mint, mb.name, mb.symbol, mb_reason or "Moonbag"
                                ):
                                    return
                                _bump_counter("sell_failed_chain")
                                warn = f"⚠ Moonbag exit failed on-chain for {mb.name} ({mb.symbol}); keeping open"
                                print(warn)
                                await broadcast_log(warn, "warn")
                                return
                        realized_pnl += pnl_sol_mb
                        if pnl_sol_mb >= 0:
                            wins += 1
                            consecutive_losses = 0
                        else:
                            losses += 1
                            consecutive_losses += 1
                        paper_balance += max(active_mb + pnl_sol_mb, 0.0)
                        log_trade(
                            mb.entry_time,
                            time.time(),
                            mint,
                            mb.name,
                            mb.symbol,
                            mb.creator,
                            "SELL",
                            active_mb,
                            mb.entry_price,
                            price_mb,
                            pnl_sol_mb,
                            mb_pnl,
                            mb_reason,
                        )
                        log_msg = f"🔔 EXIT {mb.name} ({mb.symbol}) – {mb_reason} | PnL: {mb_pnl:+.1f}% | Hold: {mb_hold:.1f}s"
                        print(log_msg)
                        level = "exit-win" if pnl_sol_mb >= 0 else "exit-loss"
                        await broadcast_log(log_msg, level)
                        confirm_mark = "✅" if MODE_LIVE and sell_ok else ""
                        trade_history.append(
                            {
                                "time": datetime.now().strftime("%H:%M:%S"),
                                "timestamp": time.time() * 1000,
                                "mint": mint,
                                "action": "sell",
                                "name": f"{mb.name} {confirm_mark}".strip(),
                                "symbol": mb.symbol,
                                "pnl_pct": round(mb_pnl, 2),
                                "pnl_sol": round(pnl_sol_mb, 6),
                                "projected_pnl_sol": round(pnl_sol_mb, 6),
                                "execution_confirmed": bool(MODE_LIVE and sell_ok),
                                "simulated": not MODE_LIVE,
                                "confirmation_mark": confirm_mark,
                                "cum_pnl": round(realized_pnl, 6),
                                "balance": round(paper_balance, 4),
                                "hold_time": round(mb_hold, 1),
                                "reason": mb_reason,
                            }
                        )
                        if _tracks_live_wallet():
                            wsnap = await wallet_chain_snapshot(force_rpc=True)
                            trade_history[-1]["actual_wallet_pnl"] = (
                                _actual_wallet_pnl_from_snapshot(wsnap)
                            )
                        await send_to_dashboard(
                            {"type": "trade", "data": trade_history[-1]}
                        )
                        if MODE_LIVE:
                            pass
                        moonbags.pop(mint, None)
                        print(
                            f"✅ Closed {mb.name} | Bal: {paper_balance:.4f} | W/L: {wins}/{losses}"
                        )
                        await broadcast_log(
                            f"✅ Closed {mb.name} | Bal: {paper_balance:.4f}", level
                        )
                        await broadcast_stats()
        except Exception:
            pass
    if mint not in positions:
        return
    pos = positions[mint]
    if pos.closing or pos.execution_pending:
        return
    tx_type = str(msg.get("txType", "")).lower()
    trader = (
        msg.get("traderPublicKey") or msg.get("user") or msg.get("owner") or ""
    ).strip()
    try:
        event_sol_amount = float(msg.get("solAmount", 0) or 0.0)
    except Exception:
        event_sol_amount = 0.0
    if (
        bool(CONFIG.get("volume_exit_enabled", True))
        and volume_signal is not None
        and (tx_type == "sell")
    ):
        volume_signal.record(mint, max(0.0, event_sol_amount))
    try:
        vsol = float(msg.get("vSolInBondingCurve", 0))
        vtokens = float(msg.get("vTokensInBondingCurve", 0))
        if vsol <= 0 or vtokens <= 0:
            return
        price = vsol / vtokens
    except Exception:
        return
    exit_grace = float(CONFIG.get("exit_grace_sec", 8.0) or 8.0)
    in_exit_grace = time.time() - pos.entry_time < exit_grace
    panic_enabled = bool(CONFIG.get("dev_dump_panic_enabled", True))
    if (
        not in_exit_grace
        and panic_enabled
        and (tx_type == "sell")
        and pos.creator
        and trader
        and (trader == pos.creator)
    ):
        try:
            dev_sell_sol = float(msg.get("solAmount", 0) or 0.0)
        except Exception:
            dev_sell_sol = 0.0
        base_notional = max(float(pos.remaining_size_sol or 0.0), 1e-09)
        dev_sell_pct = (
            dev_sell_sol / base_notional * 100.0 if base_notional > 0 else 0.0
        )
        min_sol = float(CONFIG.get("dev_dump_min_sol", 0.8) or 0.8)
        min_pct = float(CONFIG.get("dev_dump_min_pct_position", 20.0) or 20.0)
        if dev_sell_sol >= min_sol or dev_sell_pct >= min_pct:
            async with state_lock:
                if pos.closing:
                    return
                pos.closing = True
            now = time.time()
            pnl_pct = (price / pos.entry_price - 1.0) * 100.0
            hold = now - pos.entry_time
            active = pos.remaining_size_sol
            pnl_sol = active * (pnl_pct / 100.0)
            reason = "EMERGENCY_DEVDUMP"
            sell_ok = True
            if MODE_LIVE:
                sell_ok = await live_sell_pump(mint, "100%", reason, pnl_pct)
                if not sell_ok:
                    pos.closing = False
                    if await _maybe_log_sell_cooldown(
                        mint, pos.name, pos.symbol, reason
                    ):
                        return
                    _bump_counter("sell_failed_chain")
                    warn = f"⚠ Dev-dump panic exit failed on-chain for {pos.name} ({pos.symbol}); keeping open"
                    print(warn)
                    await broadcast_log(warn, "warn")
                    return
            realized_pnl += pnl_sol
            if pnl_sol >= 0:
                wins += 1
                consecutive_losses = 0
            else:
                losses += 1
                consecutive_losses += 1
                if pos.creator:
                    add_to_creator_blacklist(pos.creator, pos.name)
                if consecutive_losses >= CONFIG["cooldown_losses"]:
                    cooldown_until = now + CONFIG["cooldown_sec"]
            paper_balance += max(active + pnl_sol, 0.0)
            log_trade(
                pos.entry_time,
                now,
                mint,
                pos.name,
                pos.symbol,
                pos.creator,
                "SELL",
                active,
                pos.entry_price,
                price,
                pnl_sol,
                pnl_pct,
                reason,
            )
            log_msg = f"🚨 DEV DUMP EXIT {pos.name} ({pos.symbol}) | dev sell {dev_sell_sol:.3f} SOL ({dev_sell_pct:.1f}% pos) | PnL: {pnl_pct:+.1f}%"
            print(log_msg)
            level = "exit-win" if pnl_sol >= 0 else "exit-loss"
            await broadcast_log(log_msg, level)
            confirm_mark = "✅" if MODE_LIVE and sell_ok else ""
            trade_history.append(
                {
                    "time": datetime.now().strftime("%H:%M:%S"),
                    "timestamp": now * 1000,
                    "mint": mint,
                    "action": "sell",
                    "name": f"{pos.name} {confirm_mark}".strip(),
                    "symbol": pos.symbol,
                    "pnl_pct": round(pnl_pct, 2),
                    "pnl_sol": round(pnl_sol, 6),
                    "projected_pnl_sol": round(pnl_sol, 6),
                    "execution_confirmed": bool(MODE_LIVE and sell_ok),
                    "simulated": not MODE_LIVE,
                    "confirmation_mark": confirm_mark,
                    "cum_pnl": round(realized_pnl, 6),
                    "balance": round(paper_balance, 4),
                    "hold_time": round(hold, 1),
                    "reason": reason,
                }
            )
            if _tracks_live_wallet():
                wsnap = await wallet_chain_snapshot(force_rpc=True)
                trade_history[-1]["actual_wallet_pnl"] = (
                    _actual_wallet_pnl_from_snapshot(wsnap)
                )
            await send_to_dashboard({"type": "trade", "data": trade_history[-1]})
            if MODE_LIVE:
                pass
            positions.pop(mint, None)
            print(
                f"✅ Closed {pos.name} | Bal: {paper_balance:.4f} | W/L: {wins}/{losses}"
            )
            await broadcast_log(
                f"✅ Closed {pos.name} | Bal: {paper_balance:.4f}", level
            )
            await broadcast_stats()
            return
    if not in_exit_grace and CONFIG["velocity_check"] and (pos.prev_price > 0):
        tick_drop = (price / pos.prev_price - 1.0) * 100.0
        if tick_drop <= -CONFIG["velocity_drop"]:
            async with state_lock:
                if pos.closing:
                    return
                pos.closing = True
            now = time.time()
            pnl_pct = (price / pos.entry_price - 1.0) * 100.0
            hold = now - pos.entry_time
            active = pos.remaining_size_sol
            pnl_sol = active * (pnl_pct / 100.0)
            sell_ok = True
            if MODE_LIVE:
                sell_ok = await live_sell_pump(mint, "100%", "VelocityDump", pnl_pct)
                if not sell_ok:
                    pos.closing = False
                    if await _maybe_log_sell_cooldown(
                        mint, pos.name, pos.symbol, "VelocityDump"
                    ):
                        return
                    _bump_counter("sell_failed_chain")
                    warn = f"⚠ Velocity exit failed on-chain for {pos.name} ({pos.symbol}); keeping open"
                    print(warn)
                    await broadcast_log(warn, "warn")
                    return
            realized_pnl += pnl_sol
            if pnl_sol >= 0:
                wins += 1
                consecutive_losses = 0
            else:
                losses += 1
                consecutive_losses += 1
                if pos.creator:
                    add_to_creator_blacklist(pos.creator, pos.name)
                if consecutive_losses >= CONFIG["cooldown_losses"]:
                    cooldown_until = now + CONFIG["cooldown_sec"]
            paper_balance += max(active + pnl_sol, 0.0)
            log_trade(
                pos.entry_time,
                now,
                mint,
                pos.name,
                pos.symbol,
                pos.creator,
                "SELL",
                active,
                pos.entry_price,
                price,
                pnl_sol,
                pnl_pct,
                "VelocityDump",
            )
            log_msg = f"⚡ VELOCITY EXIT {pos.name} ({pos.symbol}) – dropped {tick_drop:.1f}% in one tick | PnL: {pnl_pct:+.1f}%"
            print(log_msg)
            level = "exit-win" if pnl_sol >= 0 else "exit-loss"
            await broadcast_log(log_msg, level)
            confirm_mark = "✅" if MODE_LIVE and sell_ok else ""
            trade_history.append(
                {
                    "time": datetime.now().strftime("%H:%M:%S"),
                    "timestamp": now * 1000,
                    "mint": mint,
                    "action": "sell",
                    "name": f"{pos.name} {confirm_mark}".strip(),
                    "symbol": pos.symbol,
                    "pnl_pct": round(pnl_pct, 2),
                    "pnl_sol": round(pnl_sol, 6),
                    "projected_pnl_sol": round(pnl_sol, 6),
                    "execution_confirmed": bool(MODE_LIVE and sell_ok),
                    "simulated": not MODE_LIVE,
                    "confirmation_mark": confirm_mark,
                    "cum_pnl": round(realized_pnl, 6),
                    "balance": round(paper_balance, 4),
                    "hold_time": round(hold, 1),
                    "reason": "VelocityDump",
                }
            )
            if _tracks_live_wallet():
                wsnap = await wallet_chain_snapshot(force_rpc=True)
                trade_history[-1]["actual_wallet_pnl"] = (
                    _actual_wallet_pnl_from_snapshot(wsnap)
                )
            await send_to_dashboard({"type": "trade", "data": trade_history[-1]})
            if MODE_LIVE:
                pass
            positions.pop(mint, None)
            print(
                f"✅ Closed {pos.name} | Bal: {paper_balance:.4f} | W/L: {wins}/{losses}"
            )
            await broadcast_log(
                f"✅ Closed {pos.name} | Bal: {paper_balance:.4f}", level
            )
            await broadcast_stats()
            return
    pos.prev_price = price
    pos.last_price = price
    pos.last_vsol = vsol
    pos.last_update_time = time.time()
    if price > pos.max_price:
        pos.max_price = price
    force_bot_exit = False
    bot_exit_reason = ""
    adaptive_state.update_vsol_slope(vsol)
    await broadcast_stats()
    now = time.time()
    pnl_pct = (price / pos.entry_price - 1.0) * 100.0
    hold = now - pos.entry_time
    peak = (pos.max_price / pos.entry_price - 1.0) * 100.0
    rug_drop = (vsol / pos.entry_vsol - 1.0) * 100.0 if pos.entry_vsol > 0 else 0
    rug = rug_drop <= -CONFIG["rug_drop"] or vsol < CONFIG["rug_min_vsol"]
    force_full_exit = bool(CONFIG.get("force_full_exit", True))
    if not force_full_exit and (not pos.partial_sold) and (pnl_pct >= CONFIG["tp1"]):
        if MODE_LIVE and pos.size_sol <= float(
            CONFIG.get("single_exit_under_sol", 0.0) or 0.0
        ):
            pass
        else:
            async with state_lock:
                if pos.closing:
                    return
                pos.closing = True
            sell_ok = True
            if MODE_LIVE:
                tp1_size = pos.size_sol * 0.5
                if _should_skip_live_sell(tp1_size, pnl_pct, "TP1", is_tp1=True):
                    pos.closing = False
                    warn = f"🪙 TP1 skipped (dust) for {pos.name} ({pos.symbol}) | estimated output below fee floor"
                    print(warn)
                    await broadcast_log(warn, "warn")
                    return
                sell_ok = await live_sell_pump(mint, "50%")
                if not sell_ok:
                    pos.closing = False
                    if await _maybe_log_sell_cooldown(
                        mint, pos.name, pos.symbol, "TP1"
                    ):
                        return
                    _bump_counter("sell_failed_chain")
                    warn = f"⚠ TP1 sell failed on-chain for {pos.name} ({pos.symbol}); keeping full position"
                    print(warn)
                    await broadcast_log(warn, "warn")
                    return
            partial_pnl = pos.size_sol * 0.5 * (pnl_pct / 100.0)
            realized_pnl += partial_pnl
            pos.partial_sold = True
            pos.remaining_size_sol = pos.size_sol * 0.5
            paper_balance += pos.size_sol * 0.5 + partial_pnl
            log_msg = f"💰 TP1 {pos.name} ({pos.symbol}) at +{pnl_pct:.1f}%"
            print(log_msg)
            await broadcast_log(log_msg, "exit-win")
            confirm_mark = "✅" if MODE_LIVE and sell_ok else ""
            trade_history.append(
                {
                    "time": datetime.now().strftime("%H:%M:%S"),
                    "timestamp": now * 1000,
                    "mint": mint,
                    "action": "sell",
                    "name": f"{pos.name} {confirm_mark}".strip(),
                    "symbol": pos.symbol,
                    "pnl_pct": round(pnl_pct, 2),
                    "pnl_sol": round(partial_pnl, 6),
                    "projected_pnl_sol": round(partial_pnl, 6),
                    "execution_confirmed": bool(MODE_LIVE and sell_ok),
                    "simulated": not MODE_LIVE,
                    "confirmation_mark": confirm_mark,
                    "cum_pnl": round(realized_pnl, 6),
                    "balance": round(paper_balance, 4),
                    "hold_time": round(hold, 1),
                    "reason": "TP1",
                }
            )
            if _tracks_live_wallet():
                wsnap = await wallet_chain_snapshot(force_rpc=True)
                trade_history[-1]["actual_wallet_pnl"] = (
                    _actual_wallet_pnl_from_snapshot(wsnap)
                )
            await send_to_dashboard({"type": "trade", "data": trade_history[-1]})
            await broadcast_stats()
            pos.closing = False
            return
    tp2 = pnl_pct >= CONFIG["tp2"]
    sl = pnl_pct <= -CONFIG["sl"]
    effective_max_hold = (
        pos.custom_max_hold if pos.custom_max_hold > 0 else float(CONFIG["max_hold"])
    )
    timed = hold >= effective_max_hold
    emergency_trail_active = (
        pos.bot_trail_override_pct > 0 and pos.bot_trail_anchor_price > 0
    )
    trail_on = emergency_trail_active or peak >= CONFIG["trail_min"]
    trail_pct = (
        pos.bot_trail_override_pct
        if emergency_trail_active
        else float(CONFIG["trail_peak"])
    )
    trail_ref_price = (
        pos.bot_trail_anchor_price if emergency_trail_active else pos.max_price
    )
    trailed = trail_on and price <= trail_ref_price * (1.0 - trail_pct / 100.0)
    if in_exit_grace:
        tp2 = False
        sl = False
        timed = False
        trailed = False
        force_bot_exit = False
    if not (rug or tp2 or sl or timed or trailed or force_bot_exit):
        return
    async with state_lock:
        if pos.closing and (not force_bot_exit):
            return
        pos.closing = True
    reason = (
        bot_exit_reason
        if force_bot_exit
        else "RUG"
        if rug
        else "TP2"
        if tp2
        else "Trail"
        if trailed
        else "SL"
        if sl
        else "Time"
    )
    active = pos.remaining_size_sol
    pnl_sol = active * (pnl_pct / 100.0)
    is_profitable = pnl_sol >= 0
    mb_pct = 0.0 if force_full_exit else CONFIG["moonbag_pct"]
    should_moonbag = is_profitable and mb_pct > 0 and ("RUG" not in reason)
    sell_pct = 100 - mb_pct if should_moonbag else 100
    sell_size = active * (sell_pct / 100.0)
    moonbag_size = active - sell_size if should_moonbag else 0
    sell_ok = True
    if MODE_LIVE:
        if _should_skip_live_sell(sell_size, pnl_pct, reason):
            pos.closing = False
            warn = f"🪙 EXIT SKIPPED (dust) for {pos.name} ({pos.symbol}) | {reason} | estimated output below fee floor"
            print(warn)
            await broadcast_log(warn, "warn")
            return
        sell_str = f"{sell_pct}%" if sell_pct < 100 else "100%"
        sell_ok = await live_sell_pump(mint, sell_str, reason, pnl_pct)
        if not sell_ok:
            pos.closing = False
            if await _maybe_log_sell_cooldown(mint, pos.name, pos.symbol, reason):
                return
            _bump_counter("sell_failed_chain")
            warn = f"⚠ EXIT FAILED on-chain for {pos.name} ({pos.symbol}) | {reason} | keeping position open"
            print(warn)
            await broadcast_log(warn, "warn")
            return
    realized_pnl += sell_size * (pnl_pct / 100.0)
    if is_profitable:
        wins += 1
        consecutive_losses = 0
    else:
        losses += 1
        consecutive_losses += 1
        if pos.creator and (rug or pnl_pct <= -CONFIG["sl"]):
            add_to_creator_blacklist(pos.creator, pos.name)
        if consecutive_losses >= CONFIG["cooldown_losses"]:
            cooldown_until = now + CONFIG["cooldown_sec"]
    paper_balance += max(sell_size + sell_size * (pnl_pct / 100.0), 0.0)
    log_trade(
        pos.entry_time,
        now,
        mint,
        pos.name,
        pos.symbol,
        pos.creator,
        "SELL",
        sell_size,
        pos.entry_price,
        price,
        sell_size * (pnl_pct / 100.0),
        pnl_pct,
        reason,
    )
    mb_note = f" | 🌙 {mb_pct:.0f}% moonbag" if should_moonbag else ""
    log_msg = f"🔔 EXIT {pos.name} ({pos.symbol}) – {reason} | PnL: {pnl_pct:+.1f}% | Hold: {hold:.1f}s{mb_note}"
    print(log_msg)
    level = "exit-win" if is_profitable else "exit-loss"
    await broadcast_log(log_msg, level)
    confirm_mark = "✅" if MODE_LIVE and sell_ok else ""
    trade_history.append(
        {
            "time": datetime.now().strftime("%H:%M:%S"),
            "timestamp": now * 1000,
            "mint": mint,
            "action": "sell",
            "name": f"{pos.name} {confirm_mark}".strip(),
            "symbol": pos.symbol,
            "pnl_pct": round(pnl_pct, 2),
            "pnl_sol": round(sell_size * (pnl_pct / 100.0), 6),
            "projected_pnl_sol": round(sell_size * (pnl_pct / 100.0), 6),
            "execution_confirmed": bool(MODE_LIVE and sell_ok),
            "simulated": not MODE_LIVE,
            "confirmation_mark": confirm_mark,
            "cum_pnl": round(realized_pnl, 6),
            "balance": round(paper_balance, 4),
            "hold_time": round(hold, 1),
            "reason": reason + (" 🌙" if should_moonbag else ""),
        }
    )
    if _tracks_live_wallet():
        wsnap = await wallet_chain_snapshot(force_rpc=True)
        trade_history[-1]["actual_wallet_pnl"] = _actual_wallet_pnl_from_snapshot(wsnap)
    await send_to_dashboard({"type": "trade", "data": trade_history[-1]})
    if MODE_LIVE:
        pass
    positions.pop(mint, None)
    if should_moonbag and moonbag_size > 0:
        moonbags[mint] = Position(
            mint=mint,
            name=pos.name,
            symbol=pos.symbol,
            size_sol=moonbag_size,
            entry_price=pos.entry_price,
            entry_value_sol=moonbag_size,
            entry_time=pos.entry_time,
            entry_vsol=pos.entry_vsol,
            last_price=price,
            max_price=pos.max_price,
            last_vsol=vsol,
            creator=pos.creator,
            is_moonbag=True,
            remaining_size_sol=moonbag_size,
            last_update_time=now,
        )
        print(f"🌙 Moonbag: {pos.name} ({moonbag_size:.4f} SOL)")
    print(f"✅ Closed {pos.name} | Bal: {paper_balance:.4f} | W/L: {wins}/{losses}")
    await broadcast_log(f"✅ Closed {pos.name} | Bal: {paper_balance:.4f}", level)
    await broadcast_stats()


def reset_state():
    """Reset session state. Used at startup and by isolated deterministic tests."""
    global CONFIG, positions, candidates, moonbags, seen_names, recent_entry_wallets
    global _create_log_dedup, paper_balance, session_wallet_start_sol, realized_pnl
    global wins, losses, consecutive_losses, cooldown_until, state_lock, MODE_LIVE
    global EXECUTOR_MODE, TRADING_PAUSED, executor, adaptive_state, subscribed_trades
    global creator_blacklist, trade_history, dynamic_hold, volume_signal, random
    global _entry_signal_wallet_by_mint, execution_counters, _blocked_buy_mints_until
    global _recent_buy_fail_ts, _recent_sell_fail_ts, _wallet_snapshot_cache
    global \
        _wallet_snapshot_ts, \
        _WALLET_SNAPSHOT_TTL, \
        dashboard_clients, \
        mode_selected_event
    global _last_broadcast_stats_time, _sell_retry_until, _mode_lock, log_history
    global price_history, feed_state, OFFLINE, STOP_EVENT, runtime_started
    CONFIG = copy.deepcopy(DEFAULT_CONFIG)
    positions, candidates, moonbags = {}, {}, {}
    seen_names = TTLCache(120, 2000)
    recent_entry_wallets = TTLCache(300, 5000)
    _create_log_dedup = TTLCache(30, 8000)
    paper_balance, session_wallet_start_sol, realized_pnl = (
        START_PAPER_BALANCE_SOL,
        None,
        0.0,
    )
    wins = losses = consecutive_losses = 0
    cooldown_until = 0.0
    state_lock, _mode_lock = asyncio.Lock(), asyncio.Lock()
    MODE_LIVE, TRADING_PAUSED, OFFLINE = False, False, True
    EXECUTOR_MODE, executor = "paper", PaperExecutor()
    adaptive_state = AdaptiveState()
    subscribed_trades, creator_blacklist = {}, {}
    trade_history, log_history = [], deque(maxlen=500)
    dynamic_hold, volume_signal = DynamicHold(), VolumeExitSignal()
    random = _random.Random(0)
    _entry_signal_wallet_by_mint, execution_counters, _blocked_buy_mints_until = (
        {},
        {},
        {},
    )
    _recent_buy_fail_ts, _recent_sell_fail_ts = deque(maxlen=200), deque(maxlen=200)
    _wallet_snapshot_cache, _wallet_snapshot_ts, _WALLET_SNAPSHOT_TTL = {}, 0.0, 5.0
    dashboard_clients, mode_selected_event = set(), asyncio.Event()
    _last_broadcast_stats_time, _sell_retry_until = 0.0, {}
    price_history = deque(maxlen=10_000)
    feed_state = {
        "source": "offline",
        "connected": False,
        "last_event_ms": None,
        "messages": 0,
        "errors": 0,
    }
    STOP_EVENT, runtime_started = asyncio.Event(), time.monotonic()


def available_modes():
    modes = ["paper"]
    configured = (
        not OFFLINE
        and os.environ.get("BIGAL_ENABLE_LIVE") == "1"
        and os.environ.get("BIGAL_PRIVATE_KEY")
        and os.environ.get("BIGAL_RPC_URL")
    )
    if (
        configured
        and importlib.util.find_spec("solders")
        and importlib.util.find_spec("solana")
    ):
        modes.append("legacy")
    return modes


def _startup_hints():
    return {
        "available_modes": available_modes(),
        "offline": OFFLINE,
        "source": "offline" if OFFLINE else "pumpportal",
        "data_source": "synthetic offline observations"
        if OFFLINE
        else "PumpPortal public feed",
        "wallet_env": bool(os.environ.get("BIGAL_PRIVATE_KEY")),
        "rpc_ready": bool(os.environ.get("BIGAL_RPC_URL")),
        "grpc_ready": False,
        "grpc_token_ready": False,
        "jito_ready": False,
        "dashboard_url": f"http://127.0.0.1:{HTTP_PORT}",
        "ws_url": f"ws://127.0.0.1:{DASHBOARD_WS_PORT}",
    }


def _tracks_live_wallet():
    return MODE_LIVE and executor is not None


async def get_live_balance():
    return await executor.get_balance() if MODE_LIVE and executor else None


async def _wallet_token_balance_for_mint(mint):
    if not MODE_LIVE or not isinstance(executor, LegacyExecutor):
        return None
    from solders.pubkey import Pubkey
    from solana.rpc.types import TokenAccountOpts

    try:
        response = await executor._client.get_token_accounts_by_owner_json_parsed(
            executor._keypair.pubkey(), TokenAccountOpts(mint=Pubkey.from_string(mint))
        )
        return sum(
            int(account.account.data.parsed["info"]["tokenAmount"]["amount"])
            for account in response.value
        )
    except Exception:
        return None  # Unknown is never interpreted as zero balance.


async def live_buy_pump(mint, size_sol):
    if not MODE_LIVE or OFFLINE:
        return None
    params = resolve_parameters(CONFIG, adaptive_state)
    tip = _fee_capped_tip_sol(params["tip"], size_sol)
    return await executor.buy(mint, size_sol, 25, tip)


async def live_sell_pump(mint, pct="100%", reason="", pnl_pct=None):
    if not MODE_LIVE or OFFLINE or time.time() < _sell_retry_until.get(mint, 0):
        return False
    pos = positions.get(mint) or moonbags.get(mint)
    notional = pos.remaining_size_sol if pos else 0
    tip = _sell_tip_sol(
        resolve_parameters(CONFIG, adaptive_state)["tip"], notional, reason, pnl_pct
    )
    try:
        sig = await executor.sell(mint, pct, 25, tip)
    except ExecutionUncertain:
        if pos:
            await mark_execution_uncertain(pos)
        return False
    if not sig:
        _sell_retry_until[mint] = time.time() + 3
    return bool(sig)


async def mark_execution_uncertain(pos):
    global TRADING_PAUSED
    pos.execution_pending = True
    TRADING_PAUSED = True
    await broadcast_log(
        f"Transaction unresolved for {pos.symbol}; position and reserved balance retained. Reconcile the wallet before restarting this session.",
        "warn",
    )
    await send_to_dashboard({"type": "pause_status", "data": {"paused": True}})


async def _maybe_log_sell_cooldown(mint, name, symbol, reason):
    return time.time() < _sell_retry_until.get(mint, 0)


def add_to_creator_blacklist(creator, token_name):
    if creator:
        row = creator_blacklist.setdefault(creator, {"losses": 0, "tokens": []})
        row["losses"] += 1
        row["tokens"] = (row["tokens"] + [token_name])[-20:]
        if len(creator_blacklist) > 5000:
            creator_blacklist.pop(next(iter(creator_blacklist)))


def log_trade(
    entry_time,
    exit_time,
    mint,
    name,
    symbol,
    creator,
    side,
    size_sol,
    entry_price,
    exit_price,
    pnl_sol,
    pnl_pct,
    reason,
):
    if side == "SELL" and "TP1" not in reason:
        _entry_signal_wallet_by_mint.pop(mint, None)
    DATA_DIR.mkdir(exist_ok=True)
    exists = TRADE_JOURNAL_FILE.exists()
    with TRADE_JOURNAL_FILE.open("a", encoding="utf-8", newline="") as file:
        writer = csv.writer(file)
        if not exists:
            writer.writerow(
                [
                    "entry_time",
                    "exit_time",
                    "mint",
                    "name",
                    "symbol",
                    "side",
                    "size_sol",
                    "entry_price",
                    "exit_price",
                    "pnl_sol",
                    "pnl_pct",
                    "reason",
                    "simulated",
                ]
            )
        writer.writerow(
            [
                entry_time,
                exit_time,
                mint,
                name,
                symbol,
                side,
                size_sol,
                entry_price,
                exit_price,
                pnl_sol,
                pnl_pct,
                reason,
                not MODE_LIVE,
            ]
        )


async def send_to_dashboard(event, target=None):
    if event.get("type") == "trade":
        event["data"]["ts"] = int(event["data"].get("timestamp", time.time() * 1000))
        event["data"]["simulated"] = not MODE_LIVE
        event["data"]["execution_confirmed"] = bool(
            MODE_LIVE and event["data"].get("execution_confirmed")
        )
        del trade_history[:-1000]
    encoded = json.dumps(event, allow_nan=False)
    clients = [target] if target is not None else list(dashboard_clients)

    async def deliver(client):
        try:
            await asyncio.wait_for(client.send(encoded), timeout=1.0)
        except Exception:
            dashboard_clients.discard(client)

    await asyncio.gather(*(deliver(client) for client in clients))


async def broadcast_log(msg, level="info"):
    event = {
        "msg": str(msg)[:2000],
        "level": level,
        "time": datetime.now().strftime("%H:%M:%S"),
    }
    log_history.append(event)
    await send_to_dashboard({"type": "log", "data": event})


def analytics_payload():
    """Exit analytics over retained events; session total remains independently tracked.

    PnL is the original strategy's reserve-price estimate. No exchange fee or
    actual-fill data is inferred. Partial exits count as separate exit events.
    """
    rows = trade_history[-1000:]
    by_reason = {}
    by_hour = {}
    percent_sum = 0.0
    profitable = 0
    for row in rows:
        reason = str(row.get("reason", "Unknown"))[:80]
        percent = float(row.get("pnl_pct", 0))
        amount = float(row.get("pnl_sol", 0))
        group = by_reason.setdefault(reason, {"wins": 0, "losses": 0, "avg_pnl": 0.0})
        group["wins" if amount >= 0 else "losses"] += 1
        group["avg_pnl"] += percent
        profitable += amount >= 0
        percent_sum += percent
        timestamp = row.get("ts", row.get("timestamp"))
        if timestamp is not None:
            hour = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).strftime(
                "%H"
            )
            bucket = by_hour.setdefault(hour, {"trades": 0, "pnl": 0.0})
            bucket["trades"] += 1
            bucket["pnl"] += amount
    for group in by_reason.values():
        group["avg_pnl"] /= group["wins"] + group["losses"]
    return {
        "total_pnl_sol": realized_pnl,
        "total_fees_sol": None,
        "win_rate": profitable / len(rows) * 100 if rows else None,
        "avg_pnl_pct": percent_sum / len(rows) if rows else None,
        "by_reason": by_reason,
        "by_hour": dict(sorted(by_hour.items())),
        "sample_count": len(rows),
        "sample_limit": 1000,
        "hour_timezone": "UTC",
        "scope": "retained exit events; total_pnl_sol covers the full session",
        "pnl_source": "strategy_estimate",
        "fees_available": False,
    }


def feed_health_payload():
    """Report observed transport state, not an invented RPC or latency probe."""
    now_ms = int(time.time() * 1000)
    last_event = feed_state.get("last_event_ms")
    age_ms = max(0, now_ms - last_event) if last_event is not None else None
    connected = bool(feed_state["connected"])
    age_text = f"{age_ms / 1000:.1f}s" if age_ms is not None else "not observed"
    return [
        {
            "name": "Offline synthetic feed" if OFFLINE else "PumpPortal public feed",
            "healthy": connected,
            "status": "connected" if connected else "disconnected",
            "latency_ms": None,
            "last_error": feed_state.get("last_error", ""),
            "last_check": now_ms,
            "last_event_age_ms": age_ms,
            "messages": feed_state["messages"],
            "errors": feed_state["errors"],
            "detail": f"Observed transport: {'connected' if connected else 'disconnected'}; {feed_state['messages']} messages; {feed_state['errors']} invalid/rejected events; last event {age_text} ago. Network latency is unmeasured.",
        }
    ]


async def stats_payload():
    all_pos = {**positions, **moonbags}
    unrealized = sum(
        p.remaining_size_sol * (p.last_price / p.entry_price - 1)
        for p in all_pos.values()
    )
    snapshot = await wallet_chain_snapshot()
    candidate_feed = [
        {
            "name": c.name,
            "symbol": c.symbol,
            "mint": c.mint,
            "buyers": len(c.unique_buyers),
            "vol": round(sum(s for _, s in c.buy_events), 3),
            "sell_pct": round(
                sum(s for _, s in c.sell_events)
                / max(
                    0.001,
                    sum(s for _, s in c.buy_events) + sum(s for _, s in c.sell_events),
                )
                * 100,
                1,
            ),
            "bc": round(c.bc_progress(), 1),
            "age": round(time.time() - c.created_at, 1),
        }
        for c in sorted(candidates.values(), key=lambda c: c.created_at, reverse=True)[
            :50
        ]
    ]
    return {
        "balance": snapshot.get("chain_balance")
        if MODE_LIVE and snapshot.get("chain_balance") is not None
        else paper_balance,
        "pnl": realized_pnl,
        "projected_pnl": realized_pnl + unrealized,
        "actual_wallet_pnl": _actual_wallet_pnl_from_snapshot(snapshot),
        "wins": wins,
        "losses": losses,
        "win_rate": wins / (wins + losses) * 100 if wins + losses else 0,
        "open_positions": len(positions),
        "moonbags": len(moonbags),
        "moonbag_count": len(moonbags),
        "candidates": len(candidates),
        "candidate_count": len(candidates),
        "candidate_feed": candidate_feed,
        "blacklisted": len(creator_blacklist),
        "consecutive_losses": consecutive_losses,
        "cooldown_remaining": max(0, cooldown_until - time.time()),
        "positions": [p.to_dict() for p in all_pos.values()],
        "executor_type": EXECUTOR_MODE,
        "paused": TRADING_PAUSED,
        "latency": executor.latency_dict(),
        "execution_counters": dict(execution_counters),
        "health": feed_health_payload(),
        "analytics": analytics_payload(),
        "feed": dict(feed_state),
        "offline": OFFLINE,
        "simulated": not MODE_LIVE,
        "server_time_ms": int(time.time() * 1000),
        **snapshot,
    }


async def broadcast_stats(force=False):
    global _last_broadcast_stats_time
    if not force and time.time() - _last_broadcast_stats_time < 0.15:
        return
    _last_broadcast_stats_time = time.time()
    await send_to_dashboard({"type": "stats", "data": await stats_payload()})


def validate_config(data):
    if not isinstance(data, dict):
        raise ValueError("Configuration must be an object.")
    valid = {}
    for key, value in data.items():
        if key not in DEFAULT_CONFIG:
            continue
        baseline = DEFAULT_CONFIG[key]
        if isinstance(baseline, bool):
            if type(value) is not bool:
                raise ValueError(f"{key} must be boolean.")
        elif isinstance(baseline, str):
            if key != "strategy_mode" or value not in ("manual", "adaptive", "hybrid"):
                raise ValueError("Unknown strategy mode.")
        else:
            lower = -100_000 if baseline < 0 else 0
            if (
                type(value) not in (int, float)
                or not math.isfinite(value)
                or not lower <= value <= 100_000
            ):
                raise ValueError(f"{key} must be a finite number within range.")
            if key in (
                "max_positions",
                "entry_buyers",
                "cooldown_losses",
                "max_repeat_wallets",
            ) and (int(value) != value or not 1 <= value <= 100):
                raise ValueError(f"{key} must be an integer from 1 to 100.")
            if key == "trade_size" and not 0.00001 <= value <= 10:
                raise ValueError("trade_size must be from 0.00001 to 10 SOL.")
            if key in ("moonbag_pct", "random_skip_pct") and not 0 <= value <= 100:
                raise ValueError(f"{key} must be from 0 to 100.")
            if key in ("sell_ratio", "min_wallet_diversity") and not 0 <= value <= 1:
                raise ValueError(f"{key} must be from 0 to 1.")
        valid[key] = value
    return valid


def handle_config_update(data):
    update = validate_config(data)
    CONFIG.update(update)
    return list(update)


def load_custom_presets():
    try:
        if CUSTOM_PRESETS_FILE.stat().st_size > 128_000:
            return {}
        data = json.loads(CUSTOM_PRESETS_FILE.read_text(encoding="utf-8"))
        return (
            {str(k)[:64]: validate_config(v) for k, v in list(data.items())[:32]}
            if isinstance(data, dict)
            else {}
        )
    except (OSError, ValueError, TypeError):
        return {}


def get_all_presets():
    return {**PRESETS, **load_custom_presets()}


def apply_preset(name):
    preset = get_all_presets().get(name)
    if preset is None:
        return False
    handle_config_update(preset)
    return True


def save_custom_preset(name, data):
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 64:
        raise ValueError("Preset name must contain 1 to 64 characters.")
    presets = load_custom_presets()
    if name not in presets and len(presets) >= 32:
        raise ValueError("Maximum 32 custom presets.")
    presets[name] = validate_config(CONFIG if data is None else data)
    DATA_DIR.mkdir(exist_ok=True)
    temp = CUSTOM_PRESETS_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(presets, allow_nan=False), encoding="utf-8")
    temp.replace(CUSTOM_PRESETS_FILE)


def delete_custom_preset(name):
    presets = load_custom_presets()
    if name not in presets:
        return False
    del presets[name]
    CUSTOM_PRESETS_FILE.write_text(json.dumps(presets), encoding="utf-8")
    return True


async def broadcast_config():
    await send_to_dashboard({"type": "config", "data": dict(CONFIG)})


async def handle_mode_select(msg, websocket=None):
    global MODE_LIVE, EXECUTOR_MODE, executor, paper_balance, session_wallet_start_sol
    global \
        realized_pnl, \
        wins, \
        losses, \
        consecutive_losses, \
        cooldown_until, \
        TRADING_PAUSED
    mode = msg.get("mode")
    async with _mode_lock:
        try:
            if mode not in available_modes():
                raise ValueError(
                    "That mode is unavailable. Offline mode permits paper trading only."
                )
            if positions or moonbags:
                raise ValueError("Close current positions before changing mode.")
            if any(
                key in msg
                for key in ("private_key", "rpc_key", "grpc_token", "laser_key")
            ):
                raise ValueError(
                    "Credentials must be configured on the backend, not sent by the dashboard."
                )
            replacement = PaperExecutor()
            balance = START_PAPER_BALANCE_SOL
            if mode == "legacy":
                from solders.keypair import Keypair

                keypair = Keypair.from_base58_string(os.environ["BIGAL_PRIVATE_KEY"])
                replacement = LegacyExecutor(
                    keypair,
                    os.environ["BIGAL_RPC_URL"],
                    "https://pumpportal.fun/api/trade-local",
                )
                balance = await replacement.get_balance()
                if balance is None:
                    await replacement.close()
                    raise ValueError("Unable to read the configured wallet balance.")
            if hasattr(executor, "close"):
                await executor.close()
            executor, MODE_LIVE, EXECUTOR_MODE = replacement, mode == "legacy", mode
            paper_balance = float(balance)
            session_wallet_start_sol = float(balance) if MODE_LIVE else None
            realized_pnl, wins, losses, consecutive_losses, cooldown_until = (
                0.0,
                0,
                0,
                0,
                0.0,
            )
            TRADING_PAUSED = False
            trade_history.clear()
            _wallet_snapshot_cache.clear()
            _recent_buy_fail_ts.clear()
            _recent_sell_fail_ts.clear()
            mode_selected_event.set()
            await send_to_dashboard(
                {
                    "type": "mode_ack",
                    "data": {
                        "mode": "LIVE (LEGACY)" if MODE_LIVE else "PAPER",
                        "balance": paper_balance,
                        "executor_type": mode,
                        "offline": OFFLINE,
                    },
                },
                websocket,
            )
            await send_to_dashboard(
                {"type": "snapshot", "data": await snapshot_payload()}
            )
            await broadcast_stats(force=True)
        except Exception as error:
            message = (
                str(error)
                if isinstance(error, ValueError)
                else "Unable to initialize mode. Check backend configuration."
            )
            await send_to_dashboard(
                {"type": "mode_error", "data": {"error": message}}, websocket
            )


async def handle_command(message, websocket):
    global TRADING_PAUSED
    if not isinstance(message, dict):
        raise ValueError("Expected a message object.")
    command = message.get("type")
    if command == "mode_select":
        await handle_mode_select(message, websocket)
    elif command == "config_update":
        handle_config_update(message.get("data", {}))
        await broadcast_config()
    elif command == "preset":
        if not apply_preset(message.get("name")):
            raise ValueError("Unknown preset.")
        await broadcast_config()
    elif command in ("save_preset", "delete_preset"):
        if command == "save_preset":
            save_custom_preset(message.get("name"), message.get("data"))
        else:
            delete_custom_preset(message.get("name"))
        await send_to_dashboard(
            {
                "type": "presets_update",
                "data": {
                    "presets": {k: True for k in get_all_presets()},
                    "custom_presets": list(load_custom_presets()),
                },
            }
        )
    elif command == "pause_trading":
        if type(message.get("paused")) is not bool:
            raise ValueError("paused must be boolean.")
        if not message["paused"] and any(
            p.execution_pending for p in (*positions.values(), *moonbags.values())
        ):
            raise ValueError(
                "Reconcile unresolved transactions before restarting the session."
            )
        TRADING_PAUSED = message["paused"]
        await send_to_dashboard(
            {"type": "pause_status", "data": {"paused": TRADING_PAUSED}}
        )
    elif command == "manual_sell":
        mint = message.get("mint")
        if not isinstance(mint, str) or not 1 <= len(mint) <= 128:
            raise ValueError("Invalid position identifier.")
        ok = await manual_sell_position(mint)
        await send_to_dashboard(
            {"type": "manual_sell_ack", "data": {"ok": bool(ok), "mint": mint}},
            websocket,
        )
    elif command == "prepare_mode_switch":
        if positions or moonbags:
            raise ValueError("Close positions before switching sessions.")
        await send_to_dashboard({"type": "mode_switch_ready", "data": {}}, websocket)
    elif command == "terminate_bot":
        TRADING_PAUSED = True
        await send_to_dashboard({"type": "pause_status", "data": {"paused": True}})
        failed = []
        for mint in list(positions) + list(moonbags):
            if not await manual_sell_position(mint):
                failed.append(mint)
        if failed or positions or moonbags:
            await send_to_dashboard(
                {
                    "type": "toast",
                    "data": {
                        "message": "Shutdown cancelled: positions remain open. Trading is paused; inspect the positions and backend log.",
                        "level": "error",
                    },
                },
                websocket,
            )
        else:
            await send_to_dashboard(
                {
                    "type": "toast",
                    "data": {
                        "message": "Positions closed. Backend shutting down.",
                        "level": "info",
                    },
                },
                websocket,
            )
            STOP_EVENT.set()
    elif command == "validate_field":
        await send_to_dashboard(
            {
                "type": "validation_result",
                "data": {
                    "field": str(message.get("field", ""))[:64],
                    "status": "fail",
                    "message": "Configure credentials only in backend environment variables.",
                },
            },
            websocket,
        )
    else:
        raise ValueError("Unsupported command.")


async def snapshot_payload():
    payload = await stats_payload()
    payload.update(
        {
            "trade_history": trade_history[-100:],
            "config": dict(CONFIG),
            "presets": {k: True for k in get_all_presets()},
            "custom_presets": list(load_custom_presets()),
            "mode": ("LIVE (LEGACY)" if MODE_LIVE else "PAPER")
            if mode_selected_event.is_set()
            else "",
            "startup_hints": _startup_hints(),
            "price_history": list(price_history),
            "logs": list(log_history),
        }
    )
    return payload


async def dashboard_handler(websocket):
    if len(dashboard_clients) >= 8:
        await websocket.close(1013, "Too many dashboards")
        return
    dashboard_clients.add(websocket)
    payload = await snapshot_payload()
    await send_to_dashboard({"type": "snapshot", "data": payload}, websocket)
    try:
        async for raw in websocket:
            try:
                await handle_command(json.loads(raw), websocket)
            except (ValueError, TypeError, KeyError) as error:
                await send_to_dashboard(
                    {
                        "type": "toast",
                        "data": {"message": str(error)[:200], "level": "warning"},
                    },
                    websocket,
                )
    finally:
        dashboard_clients.discard(websocket)


def normalize_market_event(raw):
    if not isinstance(raw, dict) or raw.get("txType") not in ("create", "buy", "sell"):
        return None
    event = {
        key: raw[key]
        for key in (
            "mint",
            "name",
            "symbol",
            "txType",
            "traderPublicKey",
            "user",
            "owner",
            "vSolInBondingCurve",
            "vTokensInBondingCurve",
            "solAmount",
            "tokenAmount",
        )
        if key in raw
    }
    if not isinstance(event.get("mint"), str) or not 1 <= len(event["mint"]) <= 128:
        return None
    for key in ("name", "symbol", "traderPublicKey", "user", "owner"):
        if key in event and (not isinstance(event[key], str) or len(event[key]) > 128):
            return None
    for key in ("vSolInBondingCurve", "vTokensInBondingCurve"):
        value = event.get(key)
        if (
            type(value) not in (int, float)
            or not math.isfinite(value)
            or not 1e-12 <= value <= 1e18
        ):
            return None
    for key in ("solAmount", "tokenAmount"):
        if key in event and (
            type(event[key]) not in (int, float)
            or not math.isfinite(event[key])
            or not 0 <= event[key] <= 1e18
        ):
            return None
        if event.get(key, 0) > 0 and event[key] < 1e-12:
            return None
    quote = event["vSolInBondingCurve"] / event["vTokensInBondingCurve"]
    if not 1e-18 <= quote <= 1e12:
        return None
    if event.get("solAmount", 0) > 0 and event.get("tokenAmount", 0) > 0:
        if not 1e-18 <= event["solAmount"] / event["tokenAmount"] <= 1e12:
            return None
    return event


async def ingest_event(raw, subscription=None):
    event = normalize_market_event(raw)
    if event is None:
        feed_state["errors"] += 1
        return False
    feed_state["messages"] += 1
    feed_state["last_event_ms"] = int(time.time() * 1000)
    executed = (
        event.get("solAmount", 0) > 0
        and event.get("tokenAmount", 0) > 0
        and event["txType"] in ("buy", "sell")
    )
    price = (
        event["solAmount"] / event["tokenAmount"]
        if executed
        else event["vSolInBondingCurve"] / event["vTokensInBondingCurve"]
    )
    observation = {
        "mint": event["mint"],
        "name": event.get("name", ""),
        "symbol": event.get("symbol", ""),
        "timestamp": feed_state["last_event_ms"],
        "ts": feed_state["last_event_ms"],
        "id": f"observation-{feed_state['messages']}",
        "price": price,
        "simulated": OFFLINE,
        "timestamp_source": "receipt",
        "price_source": "execution" if executed else "reserve_ratio",
    }
    if executed:
        observation["size"] = event["tokenAmount"]
    price_history.append(observation)
    await send_to_dashboard({"type": "price_tick", "data": observation})
    if event["txType"] == "create":
        if len(candidates) < 2000:
            await handle_new_token(event, subscription)
    else:
        await handle_trade_event(event)
    return True


async def offline_feed_loop(interval=1.0):
    await mode_selected_event.wait()
    feed_state.update(source="offline", connected=True)
    await broadcast_log(
        "OFFLINE: fictional observations drive the original paper strategy. No network feed or live transactions.",
        "warn",
    )
    cycle = 0
    while True:
        for event in offline_events(cycle):
            await ingest_event(event)
            await asyncio.sleep(interval)
        cycle += 1


async def public_feed_loop():
    await mode_selected_event.wait()
    feed_state["source"] = "pumpportal"
    while True:
        try:
            async with websockets.connect(
                WS_URL, max_size=256_000, ping_interval=20, ping_timeout=20
            ) as socket:
                feed_state["connected"] = True
                feed_state.pop("last_error", None)
                subscribed_trades.clear()
                await socket.send(json.dumps({"method": "subscribeNewToken"}))
                tracked = list(set(candidates) | set(positions) | set(moonbags))
                if tracked:
                    await socket.send(
                        json.dumps({"method": "subscribeTokenTrade", "keys": tracked})
                    )
                async for raw in socket:
                    try:
                        await ingest_event(json.loads(raw), socket)
                    except (ValueError, TypeError, KeyError):
                        feed_state["errors"] += 1
        except Exception as error:
            feed_state["connected"] = False
            feed_state["last_error"] = type(error).__name__
            await broadcast_log(
                f"Public feed disconnected ({type(error).__name__}); retrying in 5 seconds.",
                "warn",
            )
            await asyncio.sleep(5)


async def maintenance_loop():
    while True:
        await asyncio.sleep(1)
        now = time.time()
        for mint, candidate in list(candidates.items()):
            if now - candidate.created_at > CONFIG["candidate_age"]:
                candidates.pop(mint, None)
                subscribed_trades.pop(mint, None)
        seen_names.prune()
        recent_entry_wallets.prune()
        _create_log_dedup.prune()
        for cache in (_blocked_buy_mints_until, _sell_retry_until):
            for mint, deadline in list(cache.items()):
                if deadline <= now:
                    cache.pop(mint, None)
        volume_signal.cleanup(set(positions) | set(moonbags))
        await broadcast_stats(force=True)


def start_http_server(port, host="127.0.0.1"):
    class StaticHandler(SimpleHTTPRequestHandler):
        def list_directory(self, path):
            self.send_error(404, "Build the frontend with npm run build.")
            return None

        def log_message(self, *args):
            pass

    handler = partial(StaticHandler, directory=str(PROJECT_ROOT / "dist"))
    server = ThreadingHTTPServer((host, port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


async def run_bot(args):
    global OFFLINE, DASHBOARD_WS_PORT, HTTP_PORT
    reset_state()
    OFFLINE = args.offline or args.feed == "offline"
    DASHBOARD_WS_PORT, HTTP_PORT = args.ws_port, args.http_port
    DATA_DIR.mkdir(exist_ok=True)
    if args.host != "127.0.0.1" and not OFFLINE:
        raise ValueError(
            "Non-loopback binding is supported only for offline simulation."
        )
    server = start_http_server(HTTP_PORT, args.host)
    allowed_origins = [
        f"http://{host}:{port}"
        for host in ("localhost", "127.0.0.1")
        for port in (HTTP_PORT, 5173, 4173)
    ]
    try:
        async with serve(
            dashboard_handler,
            args.host,
            DASHBOARD_WS_PORT,
            origins=allowed_origins,
            max_size=64_000,
            max_queue=16,
            ping_interval=20,
        ):
            if OFFLINE:
                mode_selected_event.set()
            print(
                f"BigAl terminal: http://127.0.0.1:{HTTP_PORT} | feed={'OFFLINE SYNTHETIC' if OFFLINE else 'public (unverified)'} | ws={DASHBOARD_WS_PORT}"
            )
            jobs = [
                asyncio.create_task(
                    offline_feed_loop(args.offline_interval)
                    if OFFLINE
                    else public_feed_loop()
                ),
                asyncio.create_task(position_monitor()),
                asyncio.create_task(maintenance_loop()),
            ]
            stopped = asyncio.create_task(STOP_EVENT.wait())
            try:
                finished, _ = await asyncio.wait(
                    [*jobs, stopped], return_when=asyncio.FIRST_COMPLETED
                )
                for task in finished:
                    if task is not stopped:
                        task.result()
            finally:
                for task in [*jobs, stopped]:
                    task.cancel()
                await asyncio.gather(*jobs, stopped, return_exceptions=True)
    finally:
        if hasattr(executor, "close"):
            await executor.close()
        server.shutdown()
        server.server_close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Use deterministic fictional market inputs; no external network.",
    )
    parser.add_argument("--feed", choices=["offline", "pumpportal"], default="offline")
    parser.add_argument("--ws-port", type=int, default=8765)
    parser.add_argument("--http-port", type=int, default=8766)
    parser.add_argument(
        "--host",
        choices=["127.0.0.1", "0.0.0.0"],
        default="127.0.0.1",
        help="0.0.0.0 is allowed only for offline containers.",
    )
    parser.add_argument(
        "--offline-interval",
        type=float,
        default=1.0,
        help="Seconds between fictional market events.",
    )
    args = parser.parse_args()
    if not 0.05 <= args.offline_interval <= 60:
        parser.error("--offline-interval must be 0.05..60 seconds")
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    try:
        asyncio.run(run_bot(args))
    except KeyboardInterrupt:
        pass


reset_state()
if __name__ == "__main__":
    main()
