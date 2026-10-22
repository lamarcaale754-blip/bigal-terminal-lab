import { describe, expect, it } from 'vitest'
import { number, price, summarize } from '../src/lib'
import type { Tick } from '../src/core/types'

describe('presentation preserves measurement meaning', () => {
  it('does not round tiny accepted prices and quantities to zero', () => {
    expect(Number(price(1e-12))).toBe(1e-12)
    expect(Number(number(1e-12))).toBe(1e-12)
  })
  it('formats ordinary prices and quantities legibly', () => {
    expect(price(120.5)).toBe('120.50')
    expect(number(4800)).toBe('4,800')
  })
  it('does not invent observations or missing volume', () => {
    const ticks: Tick[] = [
      { id: 'a', ts: 0, symbol: 'TEST', price: 100, size: 2 },
      { id: 'b', ts: 1000, symbol: 'TEST', price: 120 },
    ]
    const result = summarize(ticks)[0]
    expect(result.vwap).toBeNull()
    expect(result.size).toBeNull()
    expect(result.count).toBe(2)
    expect(result.high).toBe(120)
    expect(result.low).toBe(100)
    expect(result.change).toBeCloseTo(20)
  })
  it('uses the quantity-weighted mean and isolates symbols', () => {
    const ticks: Tick[] = [
      { id: 'a', ts: 0, symbol: 'TEST', price: 100, size: 2 },
      { id: 'b', ts: 1000, symbol: 'TEST', price: 120, size: 1 },
      { id: 'c', ts: 1000, symbol: 'OTHER', price: 500, size: 9 },
    ]
    const result = summarize(ticks).find((row) => row.symbol === 'TEST')!
    expect(result.vwap).toBeCloseTo(320 / 3)
    expect(result.size).toBe(3)
    expect(summarize([])).toEqual([])
  })
})
