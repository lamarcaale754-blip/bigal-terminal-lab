import { useTerminalStore } from '../stores/terminalStore'
import { useConfigStore } from '../stores/configStore'
import type { WSOutgoing } from '../types/ws'
import type { TradeEvent } from '../types/position'
import { dispatchFrame } from './protocol'

/** Static-host UI fixture. The Python service runs the actual strategy in offline paper mode. */
export function startPreview() {
  const start = Math.floor(Date.now() / 1000) * 1000
  const names = ['ORBIT', 'VECTOR', 'PULSE', 'NOVA', 'ATLAS', 'SCOPE']
  const price = (index: number, step: number) =>
    (0.000001 + index * 0.0000004) *
    (1 + 0.0008 * step + 0.04 * Math.sin(step / 11 + index) + 0.014 * Math.sin(step / 3))
  const mint = (index: number) => `PREVIEW_${names[index]}`
  let step = 180
  let cumulative = 0
  const history: TradeEvent[] = Array.from({ length: 24 }, (_, index) => {
    const pnl = index % 5 === 0 ? -0.004 : 0.001 + (index % 4) * 0.0008
    cumulative += pnl
    const ts = start - (24 - index) * 15000
    return {
      ts,
      time: new Date(ts).toISOString().slice(11, 19),
      mint: mint(index % names.length),
      name: `${names[index % names.length]} fixture`,
      symbol: names[index % names.length],
      action: pnl > 0 ? 'TP2' : 'SL',
      pnl_pct: (pnl / 0.05) * 100,
      pnl_sol: pnl,
      cum_pnl: cumulative,
    }
  })
  const config = useConfigStore.getState().config
  dispatchFrame({
    type: 'snapshot',
    data: {
      mode: 'PREVIEW',
      executor_type: 'preview',
      balance: 5 + cumulative,
      pnl: cumulative,
      actual_wallet_pnl: cumulative,
      wins: 19,
      losses: 5,
      paused: false,
      server_time_ms: start,
      positions: names.slice(0, 3).map((symbol, index) => ({
        mint: mint(index),
        name: `${symbol} fixture`,
        symbol,
        size_sol: 0.05,
        entry_price: price(index, 80),
        last_price: price(index, step),
        pnl_pct: (price(index, step) / price(index, 80) - 1) * 100,
        hold_time: 32 + index * 7,
        partial_sold: false,
        is_moonbag: false,
      })),
      trade_history: history,
      config,
      presets: {
        Balanced: config,
        Conservative: { ...config, trade_size: 0.025, max_positions: 3, entry_buyers: 8 },
      },
      custom_presets: [],
      startup_hints: { available_modes: [], source: 'synthetic-ui-preview' },
    },
  })
  useTerminalStore.getState().addTicks(
    names.flatMap((_, index) =>
      Array.from({ length: 181 }, (_, tick) => ({
        id: `preview:${index}:${tick}`,
        symbol: mint(index),
        ts: start - (180 - tick) * 2000,
        price: price(index, tick),
      })),
    ),
  )
  dispatchFrame({
    type: 'mode_ack',
    data: { mode: 'PREVIEW', balance: 5 + cumulative, executor_type: 'preview' },
  })
  dispatchFrame({
    type: 'log',
    data: {
      time: new Date(start).toISOString().slice(11, 19),
      level: 'info',
      msg: 'SYNTHETIC UI PREVIEW · generated observations, simulated exits, no network or wallet. Run the Python offline service to exercise the original strategy.',
    },
  })
  const update = () => {
    const state = useTerminalStore.getState()
    const ts = start + (step - 180) * 2000
    dispatchFrame({
      type: 'stats',
      data: {
        server_time_ms: ts,
        wins: state.wins,
        losses: state.losses,
        win_rate: (state.wins / Math.max(1, state.wins + state.losses)) * 100,
        open_positions: state.positions.length,
        candidate_count: names.length,
        moonbag_count: 0,
        positions: state.positions.map((position) => {
          const index = names.indexOf(position.symbol)
          const last = price(index, step)
          return {
            ...position,
            last_price: last,
            pnl_pct: (last / position.entry_price! - 1) * 100,
            hold_time: position.hold_time + 2,
          }
        }),
        candidate_feed: names.map((symbol, index) => ({
          mint: mint(index),
          symbol,
          name: `${symbol} fixture`,
          buyers: 5 + index * 2,
          vol: 0.9 + index * 0.21,
          sell_pct: 10 + index * 3,
          bc: 5 + index * 2,
          age: 12 + index * 8,
          last_price: price(index, step),
        })),
        analytics: {
          total_pnl_sol: state.pnl,
          total_fees_sol: 0,
          win_rate: (state.wins / Math.max(1, state.wins + state.losses)) * 100,
          avg_pnl_pct: 2.4,
        },
        health: [],
      },
    })
  }
  update()
  const timer = window.setInterval(() => {
    if (!useTerminalStore.getState().paused) {
      step++
      update()
    }
  }, 2000)
  const send = (message: WSOutgoing) => {
    const state = useTerminalStore.getState()
    switch (message.type) {
      case 'pause_trading':
        state.setPaused(message.paused)
        break
      case 'config_update':
        useConfigStore
          .getState()
          .setConfig({ ...useConfigStore.getState().config, ...message.data })
        break
      case 'preset': {
        const preset = state.presets[message.name]
        if (preset)
          useConfigStore.getState().setConfig({ ...useConfigStore.getState().config, ...preset })
        break
      }
      case 'save_preset':
        state.setPresets(
          {
            ...state.presets,
            [message.name]: Object.fromEntries(
              Object.entries(message.data).filter(
                (entry): entry is [string, string | number | boolean] =>
                  ['string', 'number', 'boolean'].includes(typeof entry[1]),
              ),
            ),
          },
          [...new Set([...state.customPresets, message.name])],
        )
        break
      case 'delete_preset': {
        if (!state.customPresets.includes(message.name)) break
        const remaining = { ...state.presets }
        delete remaining[message.name]
        state.setPresets(
          remaining,
          state.customPresets.filter((name) => name !== message.name),
        )
        break
      }
      case 'manual_sell': {
        const position = state.positions.find((item) => item.mint === message.mint)
        if (!position) break
        const pnl = (position.size_sol * position.pnl_pct) / 100
        const ts = Date.now()
        state.addTrade({
          mint: position.mint,
          ts,
          time: new Date(ts).toISOString().slice(11, 19),
          symbol: position.symbol,
          name: position.name,
          action: 'PREVIEW EXIT',
          pnl_pct: position.pnl_pct,
          pnl_sol: pnl,
          cum_pnl: state.pnl + pnl,
        })
        state.removePosition(position.mint)
        state.setStats({
          pnl: state.pnl + pnl,
          balance: state.balance + pnl,
          wins: state.wins + Number(pnl >= 0),
          losses: state.losses + Number(pnl < 0),
        })
        state.addToast({ message: 'Simulated preview exit recorded', level: 'success' })
        break
      }
      case 'terminate_bot':
        state.setPaused(true)
        state.addToast({ message: 'Preview paused. No backend process is running.', level: 'info' })
        break
      default:
        state.addToast({ message: 'Connect to the local backend for this command.', level: 'info' })
    }
  }
  return { send, stop: () => window.clearInterval(timer) }
}
