# Observation and chart contract

## JSONL v1

One UTF-8 JSON object per line. Blank lines, an initial UTF-8 BOM, and CRLF are accepted. A JSON array is not a session. The maximum file size is 5 MiB and the maximum number of nonblank lines is 20,000, including rejected and duplicate lines. Limit violations reject the entire import. Other validation errors reject individual lines; the user can inspect the remaining accepted records.

| Field    | Required | Meaning / bounds                                                                                                                |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`     | yes      | Nonempty string, trimmed, at most 128 characters, no ASCII control characters. Unique within the whole session, across symbols. |
| `ts`     | yes      | Safe integer milliseconds since Unix epoch, from 0 through 4102444800000 inclusive (1970-01-01 through 2100-01-01 UTC).         |
| `symbol` | yes      | 1–24 ASCII letters, digits, dots, underscores, or hyphens. Normalized to uppercase.                                             |
| `price`  | yes      | Finite USD price in the inclusive range `1e-12`–`1e12`. Convert quote currencies before import.                                 |
| `size`   | no       | Executed base-asset quantity, finite and within `1e-12`–`1e12`. Omit rather than entering zero or null when unknown.            |
| `side`   | no       | `buy` or `sell`, the recorded aggressor side. Omit if unknown.                                                                  |

Numeric strings are rejected. `NaN`, infinity, and JSON null are not valid numeric measurements. Extra fields are discarded; they never become configuration or executable content. Input URLs, nested settings, and credentials are not propagated into application state or exports.

The first **valid** observation for an ID wins. Exact repeats increment the duplicate counter. A repeated ID with different normalized fields additionally produces a conflict issue. Validation errors do not reserve IDs. Timestamp sorting is stable, so the original input order breaks ties. Provider adapters should use a stable event ID and preserve exchange sequence when timestamps are equal.

These bounds are part of the viewer's supported numeric domain. They keep sums and weighted means finite across the entire accepted session and avoid unusable chart dates. Very small values display scientifically instead of rounding to a false zero.

## Candle semantics

For interval `I` milliseconds, a tick at `t` belongs to:

```text
start = floor(t / I) * I
bucket = [start, start + I)
```

The chart exposes 30-second, 1-minute, and 5-minute intervals. A candle's timestamp is its bucket start in UTC epoch seconds, as expected by Lightweight Charts.

- Open = first observed price in event-time order.
- High / low = maximum / minimum of actual recorded prices in the bucket.
- Close = last observed price in event-time order.
- Samples = number of accepted observations in the bucket.
- Volume = sum of recorded sizes **only if every observation in that bucket has size**; otherwise null.
- Per-bucket VWAP = `sum(price × size) / sum(size)` under the same completeness condition; computed using a stable incremental weighted mean.

There are no carry-forward bars, interpolated prices, or randomized wicks. An empty interval has no candle. This also means EMA steps over **observed bars**, not an assumed uniformly complete market series.

## Indicator and display semantics

EMA9 uses `alpha = 2 / (9 + 1)` and is seeded with the first observed close. Session VWAP is cumulative from the first visible observation and is sampled at observed candle closes. The chart hides its **entire volume histogram and session VWAP** if any observation for the selected symbol in the visible prefix lacks size. CSV export still exposes per-bucket volume/VWAP where those individual buckets are complete; missing values are empty fields, never zero.

Observed-session statistics use the same visible prefix as the chart. Change is `(last / first - 1) × 100`, not a 24-hour market return. The tape shows at most the latest 200 observations for the selected symbol. It shows supplied aggressor side, not account orders or inferred order flow.

## Replay and exports

Only records with `ts <= cursor` enter the chart, tape, watchlist, and session statistics. Seeking backward reconstructs a smaller prefix; no previous future bars are retained. All records sharing a timestamp are revealed together. Stepping advances to the next distinct timestamp. Playback advances event time by real elapsed monotonic time multiplied by the selected speed and stops at the final timestamp.

The synthetic demo opens paused with 65% of the session revealed so the workspace is immediately inspectable. A local import opens paused at its first timestamp. Restart seeks to the first timestamp. At the end, Play restarts playback.

**Export candles** writes only currently visible selected-symbol candles. **Export session** writes the full normalized accepted session, including future replay observations. Full-session totals and validation diagnostics are metadata and are deliberately available before replay completes. Exported session data contains only the six allowlisted fields.

No raw rejected line is repeated in diagnostics. The original file name appears locally as a session label; files and labels are not transmitted by this application.
