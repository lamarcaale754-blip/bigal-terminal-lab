# Engineering decisions

## An explicit observation contract instead of private runtime messages

The original interface was tightly coupled to its backend state. The portfolio edition separates presentation from that runtime by accepting a small typed event schema. This makes behavior testable, prevents accidental control messages, and lets recordings from different providers share one viewer. It deliberately omits account balances and position/PnL panels: the new schema does not contain the evidence needed to calculate them.

## Observed data instead of decorative candlesticks

Wicks are extrema of observed prices, volume is a recorded quantity, and VWAP requires that quantity. Missing measurements are visible as unavailable, even if the chart looks less busy. Sparse observations cannot recover trades that were never captured. The UI and exports preserve that distinction.

## Deterministic demo instead of paid-service prerequisites

A seeded, fictional four-instrument session drives the same core as imported files. Reviewers can reproduce a chart and seek to the same moment without credentials or a paid gRPC account. Synthetic labels remain visible throughout the demo. Determinism is a verification tool, not evidence of live-market performance.

## Complete-prefix recomputation instead of fragile incremental state

For bounded recordings, recomputing from the revealed prefix is simple and testable. Backward seeks cannot leave future candles or indicators cached in the view. The cost is more work per update than an incremental stream processor. A 20,000-record limit makes this an explicit tradeoff; no hidden throughput claims are made.

## Fresh public history instead of filtering a private monorepo

Only selected presentation patterns were retained. Rebuilding the data boundary and starting a new repository avoids carrying old archives, runtime records, operational features, or unrelated history into the public artifact. The complete source project remains private.

## Static deployment instead of an unnecessary backend

The viewer needs no server-side state. A static build and optional non-root Nginx container make local startup and hosting straightforward. JSONL parsing uses a worker; imports stay local; font files are bundled. A database or API service would add deployment burden without supporting a current requirement.
