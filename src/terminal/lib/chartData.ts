import type { Candle } from '../../core/types'

interface PnlObservation {
  ts?: number
  cum_pnl: number
  pnl_sol: number
}

/** Display meanings follow the session source, not transaction confirmation. */
export function pnlLabels(mode: string) {
  const normalized = mode.toUpperCase()
  if (normalized.includes('PREVIEW'))
    return {
      title: 'Synthetic PnL',
      description: 'Generated preview trades · fictional performance',
    }
  if (normalized.includes('LIVE'))
    return {
      title: 'Estimated strategy PnL',
      description: 'Observed-price estimate · excludes reconciled fills and fees',
    }
  if (normalized.includes('PAPER'))
    return {
      title: 'Simulated realized PnL',
      description: 'Paper execution model · real fees and slippage not modeled',
    }
  return { title: 'Strategy PnL', description: 'Session accounting source unavailable' }
}

/**
 * Group recorded strategy PnL events into UTC buckets. A truncated history starts
 * from the first event's recorded pre-trade balance (cum_pnl - pnl_sol), never
 * an invented zero. Events without trustworthy times or PnL remain unplotted.
 */
export function recordedPnlCandles(
  trades: readonly PnlObservation[],
  intervalMs = 1000,
): { candles: Candle[]; omitted: number } {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0)
    throw new RangeError('Candle interval must be a positive safe integer.')
  const recorded = trades
    .filter(
      (trade) =>
        typeof trade.ts === 'number' &&
        Number.isSafeInteger(trade.ts) &&
        trade.ts >= 0 &&
        trade.ts <= 4_102_444_800_000 &&
        Number.isFinite(trade.cum_pnl) &&
        Number.isFinite(trade.pnl_sol) &&
        Number.isFinite(trade.cum_pnl - trade.pnl_sol),
    )
    .sort((a, b) => a.ts! - b.ts!)
  const candles: Candle[] = []
  for (const trade of recorded) {
    const time = (Math.floor(trade.ts! / intervalMs) * intervalMs) / 1000
    const open = trade.cum_pnl - trade.pnl_sol
    const close = trade.cum_pnl
    const last = candles.at(-1)
    if (last?.time === time) {
      last.close = close
      last.high = Math.max(last.high, open, close)
      last.low = Math.min(last.low, open, close)
      last.samples++
    } else
      candles.push({
        time,
        open,
        close,
        high: Math.max(open, close),
        low: Math.min(open, close),
        volume: null,
        vwap: null,
        samples: 1,
      })
  }
  return { candles, omitted: trades.length - recorded.length }
}

export function formatChartValue(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const magnitude = Math.abs(value)
  if (magnitude !== 0 && (magnitude < 0.000001 || magnitude >= 1e9)) return value.toExponential(6)
  const maximumFractionDigits =
    magnitude > 0 && magnitude < 1 ? Math.max(8, 6 - Math.floor(Math.log10(magnitude))) : 8
  return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits })
}

/**
 * Integer powers of ten are essential here: 1 / 1e-18 rounds below 1e18,
 * which Lightweight Charts rejects as an unsupported fractional base.
 */
export function chartPriceBase(
  candles: readonly Pick<Candle, 'open' | 'high' | 'low' | 'close'>[],
): number {
  let minimum = Infinity
  for (const candle of candles) {
    for (const value of [candle.open, candle.high, candle.low, candle.close]) {
      if (Number.isFinite(value) && value !== 0) minimum = Math.min(minimum, Math.abs(value))
    }
  }
  if (!Number.isFinite(minimum)) return 1e8
  return 10 ** Math.min(18, Math.max(8, 6 - Math.floor(Math.log10(minimum))))
}
