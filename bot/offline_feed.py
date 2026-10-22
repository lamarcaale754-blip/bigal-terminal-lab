"""Deterministic fictional market messages; never submitted to any network.

The sequence deliberately includes candidate rejection, profitable trends, and
adverse moves. These inputs exercise the actual strategy; outcomes are computed
by that strategy and are not canned trade or performance records.
"""


def offline_events(cycle: int = 0):
    mint = f"OFFLINE-FICTIONAL-{cycle:06d}"
    symbol = ("ALPHA", "BETA", "GAMMA", "DELTA")[cycle % 4]
    base = {
        "mint": mint,
        "name": f"{symbol.title()} Paper {cycle}",
        "symbol": symbol,
        "vTokensInBondingCurve": 1_000_000.0,
    }
    reserve = 10.0
    yield {
        **base,
        "txType": "create",
        "traderPublicKey": f"fictional-creator-{cycle}",
        "vSolInBondingCurve": reserve,
    }
    for step in range(1, 37):
        amount = (0.30, 0.42, 0.56, 0.72)[step % 4]
        selling = (cycle % 2 == 1 and step >= 7) or step >= 27
        reserve = max(2.0, reserve + (-amount if selling else amount))
        yield {
            **base,
            "txType": "sell" if selling else "buy",
            "traderPublicKey": f"fictional-wallet-{cycle}-{step}",
            "vSolInBondingCurve": round(reserve, 6),
            "solAmount": amount,
            # The fixture supplies an explicit base quantity, not a chart guess.
            "tokenAmount": amount / (reserve / 1_000_000.0),
        }
