import { describe, expect, it } from 'vitest'
import {
  recordedPnlCandles,
  chartPriceBase,
  formatChartValue,
  pnlLabels,
} from '../src/terminal/lib/chartData'
import { aggregateCandles, sessionVwap } from '../src/core/candles'
import type { Tick } from '../src/core/types'

describe('original terminal realized PnL chart', () => {
  it('shows no historical candles when no events were recorded', () => {
    expect(recordedPnlCandles([])).toEqual({ candles: [], omitted: 0 })
  })

  it('uses a truncated history event’s actual prior PnL instead of resetting it to zero', () => {
    const { candles } = recordedPnlCandles([{ ts: 1_700_000_000_123, cum_pnl: 12, pnl_sol: 2 }])
    expect(candles).toEqual([
      {
        time: 1_700_000_000,
        open: 10,
        high: 12,
        low: 10,
        close: 12,
        volume: null,
        vwap: null,
        samples: 1,
      },
    ])
  })

  it('sorts event times without mutating the stored trade tape', () => {
    const trades = Object.freeze([
      Object.freeze({ ts: 2000, cum_pnl: 5, pnl_sol: -2 }),
      Object.freeze({ ts: 1000, cum_pnl: 7, pnl_sol: 3 }),
    ])
    expect(
      recordedPnlCandles(trades).candles.map(({ time, open, close }) => ({ time, open, close })),
    ).toEqual([
      { time: 1, open: 4, close: 7 },
      { time: 2, open: 7, close: 5 },
    ])
    expect(trades.map((trade) => trade.ts)).toEqual([2000, 1000])
  })

  it('combines same-second events in stable arrival order using only known extremes', () => {
    const { candles } = recordedPnlCandles([
      { ts: 1100, cum_pnl: 12, pnl_sol: 2 },
      { ts: 1100, cum_pnl: 9, pnl_sol: -3 },
    ])
    expect(candles).toEqual([
      { time: 1, open: 10, high: 12, low: 9, close: 9, volume: null, vwap: null, samples: 2 },
    ])
  })

  it('keeps empty periods empty and treats buckets as half-open UTC intervals', () => {
    const { candles } = recordedPnlCandles(
      [
        { ts: 14_999, cum_pnl: 1, pnl_sol: 1 },
        { ts: 15_000, cum_pnl: 2, pnl_sol: 1 },
        { ts: 90_000, cum_pnl: 3, pnl_sol: 1 },
      ],
      15_000,
    )
    expect(candles.map((candle) => candle.time)).toEqual([0, 15, 90])
  })

  it('omits missing, fractional, negative, and unsupported timestamps instead of inventing dates', () => {
    const { candles, omitted } = recordedPnlCandles([
      { cum_pnl: 2, pnl_sol: 1 },
      { ts: 1.5, cum_pnl: 2, pnl_sol: 1 },
      { ts: -1, cum_pnl: 2, pnl_sol: 1 },
      { ts: Number.NaN, cum_pnl: 2, pnl_sol: 1 },
      { ts: 4_102_444_800_001, cum_pnl: 2, pnl_sol: 1 },
      { ts: 0, cum_pnl: 2, pnl_sol: 1 },
    ])
    expect(omitted).toBe(5)
    expect(candles).toHaveLength(1)
    expect(candles[0].time).toBe(0)
  })

  it('omits unknown and overflowing PnL while accepting actual zero and losses', () => {
    const { candles, omitted } = recordedPnlCandles([
      { ts: 0, cum_pnl: Number.NaN, pnl_sol: 1 },
      { ts: 1000, cum_pnl: 1, pnl_sol: Number.NaN },
      { ts: 2000, cum_pnl: Number.MAX_VALUE, pnl_sol: -Number.MAX_VALUE },
      { ts: 3000, cum_pnl: 0, pnl_sol: -2 },
      { ts: 4000, cum_pnl: -3, pnl_sol: -3 },
    ])
    expect(omitted).toBe(3)
    expect(candles.map(({ open, high, low, close }) => ({ open, high, low, close }))).toEqual([
      { open: 2, high: 2, low: 0, close: 0 },
      { open: 0, high: 0, low: -3, close: -3 },
    ])
  })

  it('does not bridge missing rows by pretending the previous visible close was known before a later trade', () => {
    const { candles, omitted } = recordedPnlCandles([
      { ts: 1000, cum_pnl: 2, pnl_sol: 2 },
      { cum_pnl: 7, pnl_sol: 5 },
      { ts: 3000, cum_pnl: 9, pnl_sol: 2 },
    ])
    expect(omitted).toBe(1)
    expect(candles[1].open).toBe(7)
    expect(candles[1].low).toBe(7)
    expect(candles.every((candle) => candle.volume === null && candle.vwap === null)).toBe(true)
  })

  it.each([0, -1, 1.5, Number.NaN, Infinity])('rejects invalid candle interval %s', (interval) => {
    expect(() => recordedPnlCandles([], interval)).toThrow(RangeError)
  })
})

describe('token charts use observed market data', () => {
  it('plots actual token prices, never bonding-curve progress, and invents no candle wicks', () => {
    const observations = [
      { id: 'later', ts: 2000, symbol: 'mint-1', price: 0.000003, size: 2, bc: 89 },
      { id: 'first', ts: 1000, symbol: 'mint-1', price: 0.000002, size: 4, bc: 78 },
      { id: 'other', ts: 1500, symbol: 'mint-2', price: 50, size: 100, bc: 100 },
    ]
    expect(aggregateCandles(observations, 'mint-1', 15_000)).toEqual([
      {
        time: 0,
        open: 0.000002,
        high: 0.000003,
        low: 0.000002,
        close: 0.000003,
        volume: 6,
        vwap: expect.closeTo(0.000002333333333333333, 15),
        samples: 2,
      },
    ])
  })

  it('renders a single sampled price as a flat bar with unavailable volume', () => {
    const observations: Tick[] = [{ id: 'one', ts: 1234, symbol: 'mint', price: 0.000002 }]
    expect(aggregateCandles(observations, 'mint', 1000)).toEqual([
      {
        time: 1,
        open: 0.000002,
        high: 0.000002,
        low: 0.000002,
        close: 0.000002,
        volume: null,
        vwap: null,
        samples: 1,
      },
    ])
    expect(sessionVwap(observations, 'mint', 1000)).toEqual([])
  })

  it('suppresses session VWAP when any price snapshot lacks an executed quantity', () => {
    const observations: Tick[] = [
      { id: 'trade', ts: 1000, symbol: 'mint', price: 2, size: 3 },
      { id: 'snapshot', ts: 2000, symbol: 'mint', price: 4 },
    ]
    expect(aggregateCandles(observations, 'mint', 15_000)[0]).toMatchObject({
      volume: null,
      vwap: null,
      samples: 2,
    })
    expect(sessionVwap(observations, 'mint', 15_000)).toEqual([])
  })
})

describe('chart scales and labels', () => {
  it('distinguishes estimated live accounting from simulated and fictional performance', () => {
    expect(pnlLabels('LIVE (LEGACY)')).toMatchObject({ title: 'Estimated strategy PnL' })
    expect(pnlLabels('LIVE (LEGACY)').description).toContain('fees')
    expect(pnlLabels('PAPER').title).toBe('Simulated realized PnL')
    expect(pnlLabels('PREVIEW').title).toBe('Synthetic PnL')
    expect(pnlLabels('').description).toContain('unavailable')
  })
  it('preserves tiny prices and signed losses instead of displaying an apparent zero', () => {
    expect(formatChartValue(1e-12)).toBe('1.000000e-12')
    expect(formatChartValue(-1e-12)).toBe('-1.000000e-12')
    expect(formatChartValue(0.000001123456)).toBe('0.000001123456')
    expect(formatChartValue(0)).toBe('0.0000')
    expect(formatChartValue(1e12)).toBe('1.000000e+12')
    expect(formatChartValue(Number.NaN)).toBe('—')
  })

  it('uses the exact power-of-ten base supported by Lightweight Charts for tiny prices', () => {
    const base = chartPriceBase([{ open: 1e-12, high: 2e-12, low: 1e-12, close: 1.5e-12 }])
    expect(base).toBe(1e18)
    expect(base).not.toBe(1 / 1e-18)
  })

  it('uses stable finite scales for empty, zero, ordinary, and extreme values', () => {
    expect(chartPriceBase([])).toBe(1e8)
    expect(chartPriceBase([{ open: 0, high: 0, low: 0, close: 0 }])).toBe(1e8)
    expect(chartPriceBase([{ open: 2, high: 4, low: 1, close: 3 }])).toBe(1e8)
    expect(chartPriceBase([{ open: 1e-200, high: 1e-200, low: 1e-200, close: 1e-200 }])).toBe(1e18)
  })
})
