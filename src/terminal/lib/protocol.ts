import { useTerminalStore } from '../stores/terminalStore'
import { useConfigStore } from '../stores/configStore'
import type { CandidateData, PositionData, TradeEvent, PresetMap } from '../types/position'
import type { TerminalPayload } from '../types/ws'
import type { Tick } from '../../core/types'

type RecordData = Record<string, unknown>
export const record = (value: unknown): value is RecordData =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value.slice(0, 4096) : fallback
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const num = (value: unknown, fallback = 0) => (finite(value) ? value : fallback)
const rows = (value: unknown) => (Array.isArray(value) ? value.filter(record).slice(0, 2000) : [])
let logId = 0

function position(value: RecordData): PositionData {
  return {
    mint: text(value.mint),
    name: text(value.name),
    symbol: text(value.symbol),
    size_sol: num(value.size_sol),
    pnl_pct: num(value.pnl_pct),
    hold_time: num(value.hold_time),
    partial_sold: value.partial_sold === true,
    is_moonbag: value.is_moonbag === true,
    closing: value.closing === true,
    entry_price: finite(value.entry_price) ? value.entry_price : undefined,
    last_price: finite(value.last_price) ? value.last_price : undefined,
  }
}
function candidate(value: RecordData): CandidateData {
  return {
    mint: text(value.mint),
    name: text(value.name),
    symbol: text(value.symbol),
    buyers: num(value.buyers),
    vol: num(value.vol),
    sell_pct: num(value.sell_pct),
    bc: num(value.bc),
    age: num(value.age),
    last_price: finite(value.last_price) ? value.last_price : undefined,
  }
}
function trade(value: RecordData): TradeEvent {
  return {
    simulated: typeof value.simulated === 'boolean' ? value.simulated : undefined,
    execution_confirmed:
      typeof value.execution_confirmed === 'boolean' ? value.execution_confirmed : undefined,
    projected_pnl_sol: finite(value.projected_pnl_sol) ? value.projected_pnl_sol : undefined,
    mint: text(value.mint),
    ts:
      finite(value.ts) &&
      Number.isSafeInteger(value.ts) &&
      value.ts >= 0 &&
      value.ts < 4102444800000
        ? value.ts
        : undefined,
    time: text(value.time),
    name: text(value.name),
    symbol: text(value.symbol),
    action: text(value.action),
    pnl_pct: num(value.pnl_pct, NaN),
    pnl_sol: num(value.pnl_sol, NaN),
    cum_pnl: num(value.cum_pnl, NaN),
  }
}
function configPatch(value: unknown) {
  if (!record(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number | boolean | string] => {
      const [key, item] = entry
      return (
        Object.hasOwn(useConfigStore.getState().config, key) &&
        (finite(item) || typeof item === 'boolean' || typeof item === 'string')
      )
    }),
  )
}
function presets(value: unknown): PresetMap {
  if (!record(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .map(([key, config]) => [key, configPatch(config)]),
  )
}
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').slice(0, 100)
    : []

export function decodePayload(value: unknown): TerminalPayload {
  if (!record(value)) return {}
  const result: TerminalPayload = {}
  for (const key of [
    'balance',
    'pnl',
    'projected_pnl',
    'actual_wallet_pnl',
    'wins',
    'losses',
    'win_rate',
    'open_positions',
    'moonbag_count',
    'candidate_count',
    'blacklisted',
    'consecutive_losses',
    'cooldown_remaining',
    'chain_balance',
    'wallet_delta_sol',
    'blockhash_age',
    'server_time_ms',
  ] as const) {
    if (finite(value[key])) {
      if (
        key === 'server_time_ms' &&
        (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 4102444800000)
      )
        continue
      result[key] = value[key]
    }
  }
  for (const key of ['actual_wallet_pnl', 'chain_balance', 'wallet_delta_sol'] as const) {
    if (value[key] === null) result[key] = null
  }
  if (Array.isArray(value.positions))
    result.positions = rows(value.positions)
      .filter((row) => text(row.mint))
      .map(position)
  if (Array.isArray(value.candidate_feed))
    result.candidate_feed = rows(value.candidate_feed)
      .filter((row) => text(row.mint))
      .map(candidate)
  if (Array.isArray(value.trade_history))
    result.trade_history = rows(value.trade_history).map(trade)
  if (record(value.config)) result.config = configPatch(value.config)
  if (record(value.presets)) result.presets = presets(value.presets)
  if (Array.isArray(value.custom_presets)) result.custom_presets = strings(value.custom_presets)
  if (typeof value.mode === 'string') result.mode = value.mode
  if (typeof value.executor_type === 'string') result.executor_type = value.executor_type
  if (typeof value.paused === 'boolean') result.paused = value.paused
  if (record(value.startup_hints)) {
    const hints = value.startup_hints
    result.startup_hints = {
      available_modes: strings(hints.available_modes).filter((mode) =>
        ['paper', 'legacy', 'zmq_rust'].includes(mode),
      ),
      source: text(hints.source),
      dashboard_url: text(hints.dashboard_url),
      ws_url: text(hints.ws_url),
      os_name: text(hints.os_name),
      python_version: text(hints.python_version),
      wallet_env: hints.wallet_env === true,
      grpc_ready: hints.grpc_ready === true,
      helius_ready: hints.helius_ready === true,
    }
  }
  if (record(value.latency)) {
    const latency = value.latency
    result.latency = {
      zmq_ms: num(latency.zmq_ms, NaN),
      build_ms: num(latency.build_ms, NaN),
      land_ms: num(latency.land_ms, NaN),
      total_ms: num(latency.total_ms, NaN),
    }
  }
  if (record(value.execution_counters))
    result.execution_counters = Object.fromEntries(
      Object.entries(value.execution_counters).filter((entry): entry is [string, number] =>
        finite(entry[1]),
      ),
    )
  if (record(value.analytics)) {
    const analytics = value.analytics
    result.analytics = {
      total_pnl_sol: num(analytics.total_pnl_sol, NaN),
      total_fees_sol: num(analytics.total_fees_sol, NaN),
      win_rate: num(analytics.win_rate, NaN),
      avg_pnl_pct: num(analytics.avg_pnl_pct, NaN),
      by_reason: record(analytics.by_reason)
        ? Object.fromEntries(
            Object.entries(analytics.by_reason)
              .filter((entry): entry is [string, RecordData] => record(entry[1]))
              .map(([key, row]) => [
                key,
                { wins: num(row.wins), losses: num(row.losses), avg_pnl: num(row.avg_pnl) },
              ]),
          )
        : {},
      by_hour: record(analytics.by_hour)
        ? Object.fromEntries(
            Object.entries(analytics.by_hour)
              .filter((entry): entry is [string, RecordData] => record(entry[1]))
              .map(([key, row]) => [key, { trades: num(row.trades), pnl: num(row.pnl) }]),
          )
        : {},
    }
  }
  if (Array.isArray(value.health))
    result.health = rows(value.health)
      .slice(0, 20)
      .map((row) => ({
        name: text(row.name),
        healthy: row.healthy === true,
        latency_ms: num(row.latency_ms, NaN),
        last_error: text(row.last_error),
        detail: text(row.detail),
        last_check: num(row.last_check),
      }))
  return result
}

function observation(
  data: RecordData,
  receivedAt: number,
): { tick: Tick; source: 'event' | 'receipt' } | undefined {
  const mint = text(data.mint || data.symbol)
  if (!mint || !finite(data.price) || data.price <= 0) return
  const ts = finite(data.ts) ? data.ts : receivedAt
  return {
    source: finite(data.ts) && data.timestamp_source !== 'receipt' ? 'event' : 'receipt',
    tick: {
      id: text(data.id) || `${mint}:${ts}`,
      symbol: mint,
      ts,
      price: data.price,
      ...(finite(data.size) ? { size: data.size } : {}),
    },
  }
}

/** All remote input is bounded and normalized here before it enters UI stores. */
export function dispatchFrame(raw: unknown, receivedAt = Date.now()): void {
  if (!record(raw) || typeof raw.type !== 'string') return
  const terminal = useTerminalStore.getState()
  const data = record(raw.data) ? raw.data : {}
  switch (raw.type) {
    case 'snapshot':
    case 'stats': {
      const payload = decodePayload(record(data.data) ? data.data : data)
      if (raw.type === 'snapshot') terminal.setSnapshot(payload)
      else terminal.setStats(payload)
      if (Array.isArray(data.price_history)) {
        useTerminalStore.setState({ chartStreamActive: true })
        const observations = data.price_history
          .filter(record)
          .slice(-10000)
          .map((row) => observation(row, receivedAt))
          .filter((item) => item !== undefined)
        const source = observations[0]?.source ?? 'receipt'
        terminal.addTicks(
          observations.map((item) => item.tick),
          source,
        )
        if (observations.some((item) => item.source !== source))
          useTerminalStore.setState({ chartTimestampSource: 'mixed' })
      }
      if (raw.type === 'snapshot' && Array.isArray(data.logs)) {
        terminal.clearLogs()
        for (const log of rows(data.logs).slice(-300))
          dispatchFrame({ type: 'log', data: log }, receivedAt)
      }
      if (payload.config)
        useConfigStore
          .getState()
          .setConfig({ ...useConfigStore.getState().config, ...payload.config })
      const source = payload.server_time_ms ? 'event' : 'receipt'
      const ts = payload.server_time_ms ?? receivedAt
      // Sampled price observations: no invented sizes, interpolated wicks, or curve percentages.
      const samples = [...(payload.positions ?? []), ...(payload.candidate_feed ?? [])]
      if (!useTerminalStore.getState().chartStreamActive)
        terminal.addTicks(
          samples
            .filter((row) => finite(row.last_price) && row.last_price > 0)
            .map((row) => ({
              id: `${row.mint}:${ts}`,
              symbol: row.mint,
              ts,
              price: row.last_price!,
            })),
          source,
        )
      break
    }
    case 'price_tick': {
      const item = observation(data, receivedAt)
      if (!item) break
      terminal.addTicks([item.tick], item.source)
      useTerminalStore.setState({ chartStreamActive: true })
      break
    }
    case 'trade':
      terminal.addTrade(trade(data))
      break // Partial exits must not remove the entire position.
    case 'log':
      terminal.addLog({
        msg: text(data.msg),
        level: text(data.level, 'info'),
        time: text(data.time),
        id: ++logId,
      })
      break
    case 'config':
      useConfigStore
        .getState()
        .setConfig({ ...useConfigStore.getState().config, ...configPatch(data) })
      break
    case 'candidate_feed':
      terminal.setCandidateFeed(rows(raw.data).map(candidate))
      break
    case 'entry':
      if (text(data.mint))
        terminal.upsertLiveEntry({
          mint: text(data.mint),
          name: text(data.name),
          symbol: text(data.symbol),
          size: num(data.size),
        })
      break
    case 'presets_update':
      terminal.setPresets(presets(data.presets), strings(data.custom_presets))
      break
    case 'mode_ack':
      if (typeof data.mode === 'string')
        terminal.setModeAck({
          mode: data.mode,
          balance: num(data.balance),
          executor_type: text(data.executor_type),
        })
      break
    case 'mode_error':
      terminal.setModeError(text(data.error, 'Session could not start'))
      break
    case 'pause_status':
      if (typeof data.paused === 'boolean') terminal.setPaused(data.paused)
      break
    case 'toast':
      terminal.addToast({
        message: text(data.message),
        level: text(data.level),
        ttl_ms: Math.min(10000, Math.max(1000, num(data.ttl_ms, 4000))),
      })
      break
    case 'manual_sell_ack':
      terminal.addToast({
        message: data.ok ? 'Manual exit acknowledged' : 'Manual exit failed — see terminal log',
        level: data.ok ? 'success' : 'warning',
      })
      break
  }
}
