import type { Tick } from './types'

export const DEMO_START_MS = Date.UTC(2026, 3, 20, 14, 0, 0)
export const DEMO_SYMBOLS = ['ALPHA', 'BETA', 'GAMMA', 'DELTA'] as const

/**
 * Deterministic SYNTHETIC fixture. These fictional assets and quantities are
 * generated only here, never in the chart engine or presented as live prices.
 */
export function makeDemoTicks(): Tick[] {
  let state = 0x1a2b3c4d
  const next = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4_294_967_296
  }
  const prices = [120, 48, 8, 230]
  const ticks: Tick[] = []
  for (let step = 0; step < 1200; step++) {
    for (let asset = 0; asset < DEMO_SYMBOLS.length; asset++) {
      const symbol = DEMO_SYMBOLS[asset]
      const previous = prices[asset]
      const cyclicalDrift = Math.sin(step / 75 + asset) * 0.00025
      const shock = (next() - 0.5) * (0.004 + asset * 0.0005)
      prices[asset] = Math.max(0.01, previous * (1 + cyclicalDrift + shock))
      const price = Math.round(prices[asset] * 10_000) / 10_000
      const size = Math.round((0.5 + next() * 8) * 100) / 100
      ticks.push({
        id: `demo-${symbol}-${step.toString().padStart(4, '0')}`,
        ts: DEMO_START_MS + step * 2500,
        symbol,
        price,
        size,
        side: price >= previous ? 'buy' : 'sell',
      })
    }
  }
  return ticks
}
