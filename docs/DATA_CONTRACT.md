# Terminal data contract

## WebSocket messages

The backend emits `snapshot`, `stats`, `price_tick`, `candidate_feed`, `entry`, `trade`, `log`, `config`, `presets_update`, `mode_ack`, `mode_error`, `pause_status`, `manual_sell_ack` and `toast` frames. Each has a `type` and `data`. Unknown frame types are ignored by the frontend. Runtime fields are normalized before entering Zustand; the TypeScript interfaces live in `src/terminal/types`.

A snapshot includes recent positions, trade history, price history, logs, configuration, preset names and available modes. Stats are partial patches: omitted collections retain their previous value, while an explicit empty array clears one. Trade events describe journal activity; authoritative position snapshots determine whether a position remains after a partial exit.

```json
{
  "type": "price_tick",
  "data": {
    "id": "observation-42",
    "mint": "OFFLINE-FICTIONAL-000001",
    "ts": 1776693600000,
    "timestamp_source": "receipt",
    "price": 0.000012,
    "size": 4000,
    "simulated": true
  }
}
```

- `ts`: integer UTC epoch milliseconds. Provider events in this adapter are timestamped on receipt, not claimed as exchange event time.
- `price`: SOL per base token. When both trade quantities are supplied, the adapter derives executed price from SOL/base quantity. Reserve-ratio observations are price-only estimates and do not supply executed size.
- `size`: optional positive executed base quantity. Missing quantity remains unknown. The UI accepts values from `1e-12` to `1e12` and timestamps through 2100-01-01.
- `id`: stable observation identifier. Duplicate IDs do not replace the first accepted observation.
- `simulated`: true for offline fixture observations; the session's source/mode remains visible.

The frontend prefers the dedicated price stream. It does not add extra position samples when that stream is active, since doing so would double-count observations and corrupt volume. Older snapshot-only sources may supply `last_price` with `server_time_ms`; these are sampled price observations with no inferred quantity. `bc` and candidate cumulative `vol` are never substituted for chart price/size.

## Candles and indicators

For an interval `I` milliseconds, observation `t` belongs to `[floor(t/I)*I, floor(t/I)*I + I)`. Bars use UTC bucket starts in seconds for Lightweight Charts.

Open/close are the first/last observations in timestamp order. High/low are observed extrema. Equal timestamps retain input order. Empty intervals have no candle; there is no gap fill, interpolation, random wick or simulated volume. These are observation candles, not a claim of complete-market OHLC.

EMA9 and EMA21 are seeded with the first observed close and advance across observed bars. Session VWAP uses the retained observation window. Its entire series and the volume histogram are unavailable when any selected observation lacks executed quantity. Financial calculations use floating point for visualization and paper accounting, not settlement arithmetic.

The main chart preserves the original PnL/selected-token stack. The advanced chart provides original interval controls and indicators. Price history is limited to 10,000 observations, so indicators are explicitly window-based rather than unbounded full-day statistics.

## Strategy PnL and wallet measurements

Journal events carry recorded integer `ts`, `pnl_sol` and `cum_pnl`. These values use the retained strategy's reserve-price marks: they are simulated realized PnL in paper mode and estimated strategy PnL in Legacy mode, not reconciled fill-and-fee results. A confirmed transaction does not establish an exact execution price. The UI labels these modes and shows queried wallet balance change separately; missing fee/wallet measurements remain unavailable.

A retained history may start mid-session; the first bar begins at `cum_pnl - pnl_sol`, rather than an invented zero balance. Events in the same UTC second are grouped. Rows with missing timestamps or non-finite PnL are omitted from the chart and counted in its annotation. Open-position PnL is unrealized and shown separately.

## Commands and local state

Allowed commands include validated config updates, preset selection/save/delete, pause/resume, manual exit, mode selection and orderly termination. The browser does not supply wallet keys. Disconnected commands are rejected immediately and never replayed after reconnect.

Custom presets and CSV journal files are saved locally under ignored `.runtime/`; the browser's exported journal quotes cells and protects string cells against spreadsheet formula interpretation. Snapshot/trade collections are bounded, so exported UI history is the retained window. The local CSV journal is the longer record.

## Standalone JSONL utility

`src/core/parser.ts` also offers a tested, provider-neutral JSONL normalizer (`id`, `ts`, `symbol`, `price`, optional `size`/`side`). It validates a maximum of 5 MiB/20,000 records, strips unknown fields, reports invalid rows and conflicting IDs, and stable-sorts accepted observations. These utilities and `public/example-session.jsonl` can be used in adapters or tests; the restored terminal does not expose the previous replay app's import/seek workflow. Quote currency is the adapter's responsibility; the terminal runtime uses SOL.
