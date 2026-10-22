import { describe, expect, it } from 'vitest'
import { aggregateCandles, ema, sessionVwap, upperBoundTime } from '../src/core/candles'
import { DEMO_START_MS, makeDemoTicks } from '../src/core/demo'
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_RECORDS,
  MAX_OBSERVATION_VALUE,
  MAX_TIMESTAMP_MS,
  MIN_OBSERVATION_VALUE,
  MIN_TIMESTAMP_MS,
  parseJsonl,
} from '../src/core/parser'
import type { Tick } from '../src/core/types'

const tick = (id: string, ts: number, price: number, size?: number): Tick => ({
  id,
  ts,
  symbol: 'ALPHA',
  price,
  ...(size === undefined ? {} : { size }),
})
const jsonl = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join('\n')

describe('JSONL boundary', () => {
  it('normalizes known fields, orders by event time, and preserves source order on ties', () => {
    const result = parseJsonl(
      jsonl([
        {
          ...tick('last', 2000, 11),
          symbol: 'alpha',
          privateKey: 'never retained',
          config: { url: 'ignored' },
        },
        tick('first', 1000, 9),
        tick('tie', 1000, 10),
      ]),
    )
    expect(result.issues).toEqual([])
    expect(result.ticks.map((row) => row.id)).toEqual(['first', 'tie', 'last'])
    expect(result.ticks[2]).toEqual(tick('last', 2000, 11))
  })

  it('ignores exact duplicate IDs and surfaces conflicts without replacing first observation', () => {
    const first = tick('same', 2000, 100, 2)
    const result = parseJsonl(jsonl([first, first, { ...first, ts: 1000, price: 200 }]))
    expect(result.ticks).toEqual([first])
    expect(result.duplicateCount).toBe(2)
    expect(result.issues).toEqual([
      { line: 3, message: expect.stringContaining('Conflicting duplicate') },
    ])
  })

  it('does not reserve an ID for an invalid observation', () => {
    const result = parseJsonl(jsonl([tick('same', 0, 0), tick('same', 0, 1)]))
    expect(result.ticks).toEqual([tick('same', 0, 1)])
    expect(result.duplicateCount).toBe(0)
    expect(result.issues).toHaveLength(1)
  })

  it('reports line numbers while retaining valid observations around malformed records', () => {
    const result = parseJsonl(
      `\uFEFF${JSON.stringify(tick('ok', 0, 10))}\r\n\r\nnope\r\nnull\r\n[]`,
    )
    expect(result.ticks).toHaveLength(1)
    expect(result.issues.map((issue) => issue.line)).toEqual([3, 4, 5])
  })

  it.each([0, -1, null, '12'])('rejects invalid price %j', (price) => {
    expect(parseJsonl(jsonl([{ ...tick('bad', 0, 1), price }])).ticks).toEqual([])
  })

  it('rejects nonfinite JSON numeric overflow, underflow, and JSON NaN syntax', () => {
    for (const value of ['1e999', '-1e999', '1e-999', '-1e-999', 'NaN', 'Infinity']) {
      const result = parseJsonl(`{"id":"bad","ts":0,"symbol":"ALPHA","price":${value}}`)
      expect(result.ticks).toEqual([])
      expect(result.issues).toHaveLength(1)
    }
  })

  it.each([
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    MAX_TIMESTAMP_MS + 1,
    8_640_000_000_000_001,
    '2026-04-20',
  ])('rejects unsupported timestamp %j', (ts) => {
    expect(parseJsonl(jsonl([{ ...tick('bad', 0, 1), ts }])).issues).toHaveLength(1)
  })

  it('accepts the inclusive timestamp, price, and quantity contract boundaries', () => {
    const rows = [
      tick('min', MIN_TIMESTAMP_MS, MIN_OBSERVATION_VALUE, MIN_OBSERVATION_VALUE),
      tick('max', MAX_TIMESTAMP_MS, MAX_OBSERVATION_VALUE, MAX_OBSERVATION_VALUE),
    ]
    const parsed = parseJsonl(jsonl(rows))
    expect(parsed.issues).toEqual([])
    expect(parsed.ticks).toEqual(rows)
    expect(new Date(parsed.ticks[1].ts).toISOString()).toBe('2100-01-01T00:00:00.000Z')
  })

  it.each([1e-13, 1e13, 1e-300, 1e300])(
    'rejects finite values outside the supported numeric range: %j',
    (value) => {
      for (const field of ['price', 'size']) {
        const result = parseJsonl(jsonl([{ ...tick('bad', 0, 1, 1), [field]: value }]))
        expect(result.ticks).toEqual([])
        expect(result.issues[0].message).toContain(`${field} must be`)
      }
    },
  )

  it('keeps a maximum-length, maximum-quantity normalized stream within chart numeric range', () => {
    const rows = Array.from({ length: MAX_IMPORT_RECORDS }, (_, index) =>
      tick(`max-${index}`, index, MAX_OBSERVATION_VALUE, MAX_OBSERVATION_VALUE),
    )
    const parsed = parseJsonl(jsonl(rows))
    expect(parsed.issues).toEqual([])
    expect(parsed.ticks).toHaveLength(MAX_IMPORT_RECORDS)
    const candle = aggregateCandles(parsed.ticks, 'ALPHA', 60_000)[0]
    expect(candle.volume).toBe(MAX_IMPORT_RECORDS * MAX_OBSERVATION_VALUE)
    expect(candle.vwap).toBeCloseTo(MAX_OBSERVATION_VALUE, -2)
    expect(Number.isFinite(candle.vwap)).toBe(true)
  })

  it('enforces identifiers, symbols, quantities, and sides', () => {
    const invalid = [
      { id: '' },
      { id: 'x'.repeat(129) },
      { id: 'x\n' },
      { symbol: '../A B' },
      { symbol: 'x'.repeat(25) },
      { size: 0 },
      { size: -3 },
      { size: null },
      { side: 'other' },
    ]
    for (const fields of invalid) {
      expect(parseJsonl(jsonl([{ ...tick('bad', 0, 1), ...fields }])).issues).toHaveLength(1)
    }
  })

  it('rejects oversized UTF-8 input before accepting partial results', () => {
    const result = parseJsonl('é'.repeat(MAX_IMPORT_BYTES / 2 + 1))
    expect(result.ticks).toEqual([])
    expect(result.issues[0].message).toContain('5 MiB')
  })

  it('rejects too many records and excludes blank lines from that count', () => {
    const row = JSON.stringify(tick('duplicate', 0, 1))
    expect(
      parseJsonl(
        Array(MAX_IMPORT_RECORDS + 1)
          .fill(row)
          .join('\n'),
      ).issues[0].message,
    ).toContain('20,000')
    const atLimit = parseJsonl(Array(MAX_IMPORT_RECORDS).fill(row).join('\n\n'))
    expect(atLimit.ticks).toHaveLength(1)
    expect(atLimit.duplicateCount).toBe(MAX_IMPORT_RECORDS - 1)
  })

  it('reports empty input without inventing a session', () => {
    expect(parseJsonl(' \n\r\n').issues[0].message).toContain('No records')
  })
})

describe('honest event-time aggregation', () => {
  const source = [
    tick('a', 1000, 100, 1),
    tick('b', 20_000, 106, 2),
    tick('c', 59_999, 98, 3),
    tick('d', 60_000, 102, 4),
    tick('e', 180_000, 110, 1),
  ]

  it('uses actual observed OHLC and half-open buckets, with no gap filling', () => {
    const candles = aggregateCandles(source, 'ALPHA', 60_000)
    expect(candles.map((c) => c.time)).toEqual([0, 60, 180])
    expect(candles[0]).toMatchObject({
      open: 100,
      high: 106,
      low: 98,
      close: 98,
      samples: 3,
      volume: 6,
    })
    expect(candles[0].vwap).toBeCloseTo((100 + 106 * 2 + 98 * 3) / 6)
    expect(candles[1]).toEqual({
      time: 60,
      open: 102,
      high: 102,
      low: 102,
      close: 102,
      samples: 1,
      volume: 4,
      vwap: 102,
    })
  })

  it('orders out-of-order observations without mutating caller arrays', () => {
    const unsorted = [source[2], source[0], source[1]]
    expect(aggregateCandles(unsorted, 'ALPHA', 60_000)[0]).toMatchObject({ open: 100, close: 98 })
    expect(unsorted.map((row) => row.id)).toEqual(['c', 'a', 'b'])
  })

  it('keeps equal-timestamp source order and isolates symbols', () => {
    const rows = [
      tick('a', 0, 11, 1),
      { ...tick('other', 0, 900, 1), symbol: 'BETA' },
      tick('b', 0, 12, 1),
    ]
    expect(aggregateCandles(rows, 'ALPHA', 60_000)[0]).toMatchObject({
      open: 11,
      close: 12,
      samples: 2,
    })
    expect(aggregateCandles(rows, 'MISSING', 60_000)).toEqual([])
  })

  it('never substitutes counts or guessed quantities for missing executed size', () => {
    const rows = [
      tick('a', 0, 10, 2),
      tick('b', 1000, 20),
      tick('c', 2000, 30, 3),
      tick('d', 60_000, 40, 4),
    ]
    const candles = aggregateCandles(rows, 'ALPHA', 60_000)
    expect(candles[0]).toMatchObject({ volume: null, vwap: null, samples: 3 })
    expect(candles[1]).toMatchObject({ volume: 4, vwap: 40 })
    expect(sessionVwap(rows, 'ALPHA', 60_000)).toEqual([])
  })

  it('makes cumulative session VWAP size-weighted, rather than averaging bucket VWAPs', () => {
    const rows = [tick('a', 0, 10, 1), tick('b', 1000, 20, 3), tick('c', 60_000, 100, 6)]
    const points = sessionVwap(rows, 'ALPHA', 60_000)
    expect(points[0]).toEqual({ time: 0, value: 17.5 })
    expect(points[1].value).toBeCloseTo(67)
  })

  it('does not let missing quantities from another symbol suppress selected VWAP', () => {
    const rows = [...source, { ...tick('price-only', 0, 50), symbol: 'BETA' }]
    expect(sessionVwap(rows, 'ALPHA', 60_000)).toHaveLength(3)
  })

  it('avoids intermediate price-times-size overflow', () => {
    const rows = [tick('a', 0, 1e300, 1e100), tick('b', 1, 2e300, 1e100)]
    expect(aggregateCandles(rows, 'ALPHA', 1000)[0].vwap).toBeCloseTo(1.5e300, -285)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid interval %j',
    (interval) => {
      expect(() => aggregateCandles(source, 'ALPHA', interval)).toThrow(RangeError)
      expect(() => sessionVwap(source, 'ALPHA', interval)).toThrow(RangeError)
    },
  )

  it('rejects invalid direct observations and unrepresentable volume', () => {
    expect(() => aggregateCandles([tick('bad', 0, Infinity)], 'ALPHA', 1000)).toThrow(RangeError)
    expect(() => aggregateCandles([tick('bad', 0, 0)], 'ALPHA', 1000)).toThrow(RangeError)
    expect(() =>
      aggregateCandles([tick('a', 0, 1, 1e308), tick('b', 1, 1, 1e308)], 'ALPHA', 1000),
    ).toThrow(RangeError)
  })

  it('calculates causal EMA and supports empty streams', () => {
    const candles = aggregateCandles(
      [tick('a', 0, 10), tick('b', 1000, 20), tick('c', 2000, 10)],
      'ALPHA',
      1000,
    )
    expect(ema(candles, 3)).toEqual([
      { time: 0, value: 10 },
      { time: 1, value: 15 },
      { time: 2, value: 12.5 },
    ])
    expect(ema(candles.slice(0, 2), 3)).toEqual(ema(candles, 3).slice(0, 2))
    expect(ema([], 3)).toEqual([])
    expect(() => ema(candles, 0)).toThrow(RangeError)
    expect(sessionVwap([], 'ALPHA', 1000)).toEqual([])
  })
})

describe('reproducible replay', () => {
  it('generates a reproducible, fully sized fictional session with unique IDs', () => {
    const first = makeDemoTicks()
    expect(first).toEqual(makeDemoTicks())
    expect(first).toHaveLength(4800)
    expect(new Set(first.map((row) => row.id)).size).toBe(4800)
    expect([...new Set(first.map((row) => row.symbol))]).toEqual([
      'ALPHA',
      'BETA',
      'GAMMA',
      'DELTA',
    ])
    expect(first[0].ts).toBe(DEMO_START_MS)
    expect(first[first.length - 1].ts).toBe(DEMO_START_MS + 1199 * 2500)
    expect(first.every((row) => row.price > 0 && row.size! > 0)).toBe(true)
    expect(parseJsonl(jsonl(first)).issues).toEqual([])
  })

  it('includes all ties at the cursor, and reveals no future price or quantity', () => {
    const rows = [tick('a', 1000, 10, 1), tick('b', 1000, 12, 1), tick('future', 2000, 900, 100)]
    expect(upperBoundTime(rows, 999)).toBe(0)
    expect(upperBoundTime(rows, 1000)).toBe(2)
    expect(upperBoundTime(rows, 1999)).toBe(2)
    expect(upperBoundTime(rows, 2000)).toBe(3)
    expect(upperBoundTime([], 0)).toBe(0)
    const visible = rows.slice(0, upperBoundTime(rows, 1000))
    expect(aggregateCandles(visible, 'ALPHA', 60_000)[0]).toMatchObject({
      high: 12,
      volume: 2,
      samples: 2,
    })
    expect(sessionVwap(visible, 'ALPHA', 60_000)).toEqual([{ time: 0, value: 11 }])
  })
})
