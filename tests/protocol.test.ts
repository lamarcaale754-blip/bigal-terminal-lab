import { beforeEach, describe, expect, it } from 'vitest'
import { decodePayload, dispatchFrame } from '../src/terminal/lib/protocol'
import { useTerminalStore } from '../src/terminal/stores/terminalStore'

beforeEach(() => useTerminalStore.getState().resetSession())
describe('backend frames and bounded terminal state', () => {
  it('accepts the backend price and size boundary without silently losing observations', () => {
    dispatchFrame({
      type: 'price_tick',
      data: { mint: 'SMALL', ts: 1000, price: 1e-18, size: 1e18, timestamp_source: 'receipt' },
    })
    expect(useTerminalStore.getState().chartTicks).toEqual([
      { id: 'SMALL:1000', symbol: 'SMALL', ts: 1000, price: 1e-18, size: 1e18 },
    ])
  })
  it('leaves unreported analytics unavailable and rejects invalid server dates', () => {
    dispatchFrame({ type: 'stats', data: { analytics: {}, server_time_ms: 1e100 } })
    expect(useTerminalStore.getState().analytics?.total_fees_sol).toBeNaN()
    expect(useTerminalStore.getState().analytics?.avg_pnl_pct).toBeNaN()
    expect(useTerminalStore.getState().serverTimeMs).toBe(0)
  })
  it('restores the newest bounded price history in one snapshot without duplicate position samples', () => {
    const history = Array.from({ length: 10002 }, (_, index) => ({
      id: String(index),
      mint: 'A',
      ts: index,
      price: 1 + index,
      size: 1,
      timestamp_source: 'receipt',
    }))
    dispatchFrame({
      type: 'snapshot',
      data: {
        price_history: history,
        positions: [{ mint: 'A', last_price: 100000 }],
        server_time_ms: 10003,
      },
    })
    const state = useTerminalStore.getState()
    expect(state.chartTicks).toHaveLength(10000)
    expect(state.chartTicks[0].id).toBe('2')
    expect(state.chartTicks.at(-1)?.id).toBe('10001')
    expect(state.chartTimestampSource).toBe('receipt')
    expect(state.chartTicks.every((tick) => tick.size === 1)).toBe(true)
  })
  it('preserves measured wallet zero and clears unavailable wallet measurements', () => {
    dispatchFrame({
      type: 'stats',
      data: { chain_balance: 0, actual_wallet_pnl: 0, wallet_delta_sol: 0 },
    })
    expect(useTerminalStore.getState().chainBalance).toBe(0)
    dispatchFrame({
      type: 'stats',
      data: { chain_balance: null, actual_wallet_pnl: null, wallet_delta_sol: null },
    })
    const state = useTerminalStore.getState()
    expect(state.chainBalance).toBeNaN()
    expect(state.actualWalletPnl).toBeNaN()
    expect(state.walletDeltaSol).toBeNaN()
  })
  it('keeps separately broadcast positions/candidates when a partial stats frame arrives', () => {
    dispatchFrame(
      {
        type: 'snapshot',
        data: {
          positions: [{ mint: 'A', last_price: 0.002 }],
          candidate_feed: [{ mint: 'B', bc: 88, vol: 12 }],
        },
      },
      1000,
    )
    dispatchFrame({ type: 'stats', data: { pnl: 1.25 } }, 2000)
    const state = useTerminalStore.getState()
    expect(state.positions).toHaveLength(1)
    expect(state.candidateFeed).toHaveLength(1)
    expect(state.pnl).toBe(1.25)
    expect(state.chartTicks).toEqual([{ id: 'A:1000', symbol: 'A', price: 0.002, ts: 1000 }])
    expect(state.chartTimestampSource).toBe('receipt')
  })
  it('never derives chart price or size from candidate curve progress or cumulative volume', () => {
    dispatchFrame({
      type: 'stats',
      data: { server_time_ms: 1000, candidate_feed: [{ mint: 'A', bc: 95, vol: 800 }] },
    })
    expect(useTerminalStore.getState().chartTicks).toEqual([])
    dispatchFrame({
      type: 'stats',
      data: {
        server_time_ms: 2000,
        candidate_feed: [{ mint: 'A', bc: 95, vol: 800, last_price: 0.002 }],
      },
    })
    expect(useTerminalStore.getState().chartTicks[0]).toEqual({
      id: 'A:2000',
      symbol: 'A',
      price: 0.002,
      ts: 2000,
    })
  })
  it('sorts actual events, ignores duplicate IDs, and labels mixed timestamp origins', () => {
    dispatchFrame({ type: 'price_tick', data: { mint: 'A', ts: 2000, price: 0.002, size: 12 } })
    dispatchFrame({ type: 'price_tick', data: { mint: 'A', ts: 2000, price: 0.009, size: 5 } })
    dispatchFrame({ type: 'price_tick', data: { mint: 'A', price: 0.001 } }, 1000)
    expect(useTerminalStore.getState().chartTicks.map((row) => row.price)).toEqual([0.001, 0.002])
    expect(useTerminalStore.getState().chartTimestampSource).toBe('mixed')
  })
  it('rejects invalid chart numeric inputs before they reach the chart library', () => {
    const invalid = [
      { ts: 1.5 },
      { ts: -1 },
      { ts: 4102444800001 },
      { price: Infinity },
      { price: 0 },
      { price: 1e13 },
      { size: 0 },
      { size: -1 },
      { size: 1e19 },
    ]
    for (const [index, patch] of invalid.entries())
      useTerminalStore
        .getState()
        .addTicks([{ id: String(index), symbol: 'A', ts: 1000, price: 0.1, ...patch }])
    expect(useTerminalStore.getState().chartTicks).toEqual([])
  })
  it('does not invent trade timestamps or PnL and does not drop positions on partial exit', () => {
    dispatchFrame({ type: 'snapshot', data: { positions: [{ mint: 'A' }] } })
    dispatchFrame({ type: 'trade', data: { mint: 'A', action: 'TP1' } })
    const state = useTerminalStore.getState()
    expect(state.positions).toHaveLength(1)
    expect(state.trades[0].ts).toBeUndefined()
    expect(state.trades[0].cum_pnl).toBeNaN()
    expect(state.trades[0].pnl_sol).toBeNaN()
  })
  it('does not change mode or queue commands from unknown incoming messages', () => {
    dispatchFrame({ type: 'mode_select', data: { mode: 'legacy' } })
    dispatchFrame(null)
    dispatchFrame({ type: 'stats', data: null })
    expect(useTerminalStore.getState().mode).toBe('')
    expect(useTerminalStore.getState().modeSelected).toBe(false)
  })
  it('bounds history and reports only supported advertised modes', () => {
    const decoded = decodePayload({
      positions: Array.from({ length: 5000 }, (_, index) => ({ mint: String(index) })),
      startup_hints: {
        available_modes: ['paper', 'legacy', 'anything'],
        private_key: 'must-not-enter-ui',
      },
    })
    dispatchFrame({ type: 'snapshot', data: decoded })
    expect(useTerminalStore.getState().positions).toHaveLength(200)
    expect(decoded.startup_hints?.available_modes).toEqual(['paper', 'legacy'])
    expect(decoded.startup_hints).not.toHaveProperty('private_key')
  })
  it('keeps snapshot mode separate from user opening the running session', () => {
    dispatchFrame({ type: 'snapshot', data: { mode: 'PAPER', executor_type: 'paper' } })
    expect(useTerminalStore.getState().snapshotMode).toBe('PAPER')
    expect(useTerminalStore.getState().modeSelected).toBe(false)
    dispatchFrame({ type: 'mode_ack', data: { mode: 'PAPER', executor_type: 'paper', balance: 5 } })
    expect(useTerminalStore.getState().modeSelected).toBe(true)
  })
})
