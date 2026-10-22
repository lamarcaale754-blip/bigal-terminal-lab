import type { Candle, Point, Tick } from './types'

function validateInterval(intervalMs: number): void {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0)
    throw new RangeError('intervalMs must be a positive safe integer.')
}

function selectedTicks(ticks: Tick[], symbol: string): Tick[] {
  const selected = ticks.filter((tick) => tick.symbol === symbol).sort((a, b) => a.ts - b.ts)
  for (const tick of selected) {
    if (
      !Number.isSafeInteger(tick.ts) ||
      tick.ts < 0 ||
      tick.ts > 8_640_000_000_000_000 ||
      !Number.isFinite(tick.price) ||
      tick.price <= 0
    ) {
      throw new RangeError(
        'Chart observations require a valid timestamp and a positive finite price.',
      )
    }
    if (tick.size !== undefined && (!Number.isFinite(tick.size) || tick.size <= 0)) {
      throw new RangeError('Observation sizes must be positive finite numbers.')
    }
  }
  return selected
}

/** Stable weighted mean avoids overflowing price * size at large magnitudes. */
function addWeight(
  mean: number,
  total: number,
  price: number,
  size: number,
): { mean: number; total: number } {
  const nextTotal = total + size
  if (!Number.isFinite(nextTotal))
    throw new RangeError('Total observed size exceeds the numeric range.')
  const weight = size / nextTotal
  return { mean: mean * (1 - weight) + price * weight, total: nextTotal }
}

/**
 * Event-time OHLC from actual supplied observations, in half-open UTC buckets.
 * No interpolation, random wicks, carry-forward bars, or inferred quantities.
 */
export function aggregateCandles(ticks: Tick[], symbol: string, intervalMs: number): Candle[] {
  validateInterval(intervalMs)
  const candles: Candle[] = []
  let candle: Candle | undefined
  let sizedTotal = 0
  let weightedMean = 0
  for (const tick of selectedTicks(ticks, symbol)) {
    const time = (Math.floor(tick.ts / intervalMs) * intervalMs) / 1000
    if (!candle || candle.time !== time) {
      candle = {
        time,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: 0,
        vwap: 0,
        samples: 0,
      }
      candles.push(candle)
      sizedTotal = 0
      weightedMean = 0
    }
    candle.high = Math.max(candle.high, tick.price)
    candle.low = Math.min(candle.low, tick.price)
    candle.close = tick.price
    candle.samples++
    if (tick.size === undefined) {
      candle.volume = null
      candle.vwap = null
    } else if (candle.volume !== null) {
      const weighted = addWeight(weightedMean, sizedTotal, tick.price, tick.size)
      sizedTotal = weighted.total
      weightedMean = weighted.mean
      candle.volume = sizedTotal
      candle.vwap = weightedMean
    }
  }
  return candles
}

/** Causal EMA of observed closes, seeded at the first observed close. */
export function ema(candles: Candle[], period: number): Point[] {
  if (!Number.isSafeInteger(period) || period < 1)
    throw new RangeError('EMA period must be a positive safe integer.')
  const alpha = 2 / (period + 1)
  let value = candles[0]?.close ?? 0
  return candles.map((candle) => {
    value = alpha * candle.close + (1 - alpha) * value
    return { time: candle.time, value }
  })
}

/**
 * Cumulative VWAP for the supplied session, sampled at observed bucket closes.
 * If any selected observation lacks executed size, the series is unavailable.
 * Call with the revealed replay prefix to prevent access to future observations.
 */
export function sessionVwap(ticks: Tick[], symbol: string, intervalMs: number): Point[] {
  validateInterval(intervalMs)
  const selected = selectedTicks(ticks, symbol)
  if (selected.some((tick) => tick.size === undefined)) return []
  const points: Point[] = []
  let total = 0
  let mean = 0
  for (const tick of selected) {
    const weighted = addWeight(mean, total, tick.price, tick.size!)
    total = weighted.total
    mean = weighted.mean
    const time = (Math.floor(tick.ts / intervalMs) * intervalMs) / 1000
    const last = points[points.length - 1]
    if (last?.time === time) last.value = mean
    else points.push({ time, value: mean })
  }
  return points
}

/** Index after the last tick at or before ts in a timestamp-sorted stream. */
export function upperBoundTime(ticks: Tick[], ts: number): number {
  let low = 0
  let high = ticks.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (ticks[middle].ts <= ts) low = middle + 1
    else high = middle
  }
  return low
}
