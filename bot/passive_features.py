"""Unchanged passive strategy helpers extracted from the local terminal."""

import time
from collections import defaultdict
from typing import Dict, List


class DynamicHold:
    def __init__(self, base=30.0, floor=10.0, ceil=90.0):
        self._b = base
        self._f = floor
        self._c = ceil

    def calc(self, buyers, volume, intel_score=0.0):
        h = (
            self._b
            * (0.7 + (min(buyers, 8) - 2) * 0.1)
            * (0.8 + min(volume, 2.0) * 0.2)
        )
        if intel_score > 20:
            h *= 1.3
        elif intel_score < -10:
            h *= 0.6
        return max(self._f, min(self._c, round(h, 1)))


class VolumeExitSignal:
    def __init__(self, window=10.0, mult=3.0):
        self._w = window
        self._m = mult
        self._s: Dict[str, List] = defaultdict(list)

    def record(self, mint, sol):
        now = time.time()
        self._s[mint].append((now, sol))
        self._s[mint] = [(t, a) for t, a in self._s[mint] if now - t < self._w * 3]

    def is_spike(self, mint):
        now = time.time()
        ev = self._s.get(mint, [])
        if len(ev) < 3:
            return (False, 0.0)
        rc = sum((a for t, a in ev if now - t < self._w))
        ol = sum((a for t, a in ev if now - t < self._w * 2 and now - t >= self._w))
        rr = rc / self._w if self._w else 0
        orr = ol / self._w if self._w else 0
        if orr > 0 and rr / orr > self._m:
            return (True, round(rr, 4))
        return (False, round(rr, 4))

    def cleanup(self, active):
        for m in [m for m in self._s if m not in active]:
            del self._s[m]

    def count(self) -> int:
        return len(self._s)
