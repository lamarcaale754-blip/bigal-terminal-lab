/** Normalized market observations. Timestamp in UTC epoch milliseconds. */
export interface Tick {
  id: string
  ts: number
  symbol: string
  price: number
  /** Executed base-asset quantity; absent for price-only observations. */
  size?: number
  side?: 'buy' | 'sell'
}

export interface ParseIssue {
  line: number
  message: string
}
export interface ParseResult {
  ticks: Tick[]
  issues: ParseIssue[]
  duplicateCount: number
}

/** UTC epoch seconds, matching Lightweight Charts. Null means unavailable. */
export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  vwap: number | null
  samples: number
}

export interface Point {
  time: number
  value: number
}
