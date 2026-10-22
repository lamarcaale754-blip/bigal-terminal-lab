import { create } from 'zustand'
import type { Tick } from '../../core/types'
import type {
  PositionData,
  CandidateData,
  TradeEvent,
  LogEntry,
  LatencyData,
  ExecutionCounters,
  AnalyticsData,
  StartupHints,
  PresetMap,
} from '../types/position'
import type { EndpointHealth } from '../types/health'
import type { TerminalPayload } from '../types/ws'

export interface ToastItem {
  id: number
  message: string
  level: 'info' | 'success' | 'warning' | 'error'
  ttl_ms: number
  created_at: number
}
let toastId = 0
export interface TerminalState {
  connected: boolean
  wsUrl: string
  mode: string
  executorType: string
  modeError: string | null
  paused: boolean
  balance: number
  pnl: number
  actualWalletPnl: number
  wins: number
  losses: number
  winRate: number
  openPositions: number
  moonbagCount: number
  candidateCount: number
  blacklisted: number
  consecutiveLosses: number
  cooldownRemaining: number
  chainBalance: number
  walletDeltaSol: number
  positions: PositionData[]
  candidateFeed: CandidateData[]
  trades: TradeEvent[]
  logs: LogEntry[]
  chartTicks: Tick[]
  chartTimestampSource: 'event' | 'receipt' | 'mixed'
  chartStreamActive: boolean
  presets: PresetMap
  customPresets: string[]
  latency: LatencyData
  executionCounters: ExecutionCounters
  analytics: AnalyticsData | null
  blockhashAge: number
  health: EndpointHealth[]
  serverTimeMs: number
  startupHints: StartupHints
  modeSelected: boolean
  snapshotMode: string
  validationResults: Record<string, { status: string; message: string }>
  toasts: ToastItem[]
  setConnected: (connected: boolean) => void
  setWsUrl: (wsUrl: string) => void
  resetSession: () => void
  setSnapshot: (data: TerminalPayload) => void
  setStats: (data: TerminalPayload) => void
  addTicks: (ticks: Tick[], source?: 'event' | 'receipt') => void
  addTrade: (trade: TradeEvent) => void
  addLog: (log: LogEntry) => void
  clearLogs: () => void
  setPresets: (presets: PresetMap, custom: string[]) => void
  setModeAck: (data: { mode: string; balance: number; executor_type: string }) => void
  setModeError: (error: string) => void
  setPaused: (paused: boolean) => void
  setValidationResult: (data: { field: string; status: string; message: string }) => void
  setCandidateFeed: (candidates: CandidateData[]) => void
  upsertLiveEntry: (entry: { mint: string; name: string; symbol: string; size: number }) => void
  removePosition: (mint: string) => void
  addToast: (data: { message: string; level: string; ttl_ms?: number }) => void
  removeToast: (id: number) => void
}

const initial = {
  connected: false,
  wsUrl: '',
  mode: '',
  executorType: '',
  modeError: null,
  paused: false,
  balance: 0,
  pnl: 0,
  actualWalletPnl: NaN,
  wins: 0,
  losses: 0,
  winRate: 0,
  openPositions: 0,
  moonbagCount: 0,
  candidateCount: 0,
  blacklisted: 0,
  consecutiveLosses: 0,
  cooldownRemaining: 0,
  chainBalance: NaN,
  walletDeltaSol: NaN,
  positions: [] as PositionData[],
  candidateFeed: [] as CandidateData[],
  trades: [] as TradeEvent[],
  logs: [] as LogEntry[],
  chartTicks: [] as Tick[],
  chartTimestampSource: 'event' as const,
  chartStreamActive: false,
  presets: {} as PresetMap,
  customPresets: [] as string[],
  // NaN is rendered as unavailable; zero would falsely report measured latency.
  latency: { zmq_ms: NaN, build_ms: NaN, land_ms: NaN, total_ms: NaN },
  executionCounters: {} as ExecutionCounters,
  analytics: null,
  blockhashAge: NaN,
  health: [] as EndpointHealth[],
  serverTimeMs: 0,
  startupHints: {} as StartupHints,
  modeSelected: false,
  snapshotMode: '',
  validationResults: {},
  toasts: [] as ToastItem[],
}

function statePatch(data: TerminalPayload): Partial<TerminalState> {
  const patch: Partial<TerminalState> = {}
  const mapping = {
    balance: 'balance',
    pnl: 'pnl',
    actual_wallet_pnl: 'actualWalletPnl',
    wins: 'wins',
    losses: 'losses',
    win_rate: 'winRate',
    open_positions: 'openPositions',
    moonbag_count: 'moonbagCount',
    candidate_count: 'candidateCount',
    blacklisted: 'blacklisted',
    consecutive_losses: 'consecutiveLosses',
    cooldown_remaining: 'cooldownRemaining',
    chain_balance: 'chainBalance',
    wallet_delta_sol: 'walletDeltaSol',
    blockhash_age: 'blockhashAge',
    server_time_ms: 'serverTimeMs',
  } as const
  for (const [wire, local] of Object.entries(mapping)) {
    const value = data[wire as keyof typeof mapping]
    if (typeof value === 'number' && Number.isFinite(value)) patch[local] = value
    else if (value === null) patch[local] = NaN
  }
  // Realized PnL is separate from any mark-to-market projection sent by the strategy.
  if (data.positions) {
    patch.positions = data.positions.slice(0, 200)
    patch.openPositions =
      data.open_positions ?? patch.positions.filter((position) => !position.is_moonbag).length
  }
  if (data.candidate_feed) patch.candidateFeed = data.candidate_feed.slice(0, 500)
  if (data.trade_history) patch.trades = data.trade_history.slice(-2000)
  if (data.presets) patch.presets = data.presets
  if (data.custom_presets) patch.customPresets = data.custom_presets
  if (data.mode !== undefined) {
    patch.mode = data.mode
    patch.snapshotMode = data.mode
  }
  if (data.executor_type) patch.executorType = data.executor_type
  if (data.paused !== undefined) patch.paused = data.paused
  if (data.startup_hints) patch.startupHints = data.startup_hints
  if (data.latency) patch.latency = data.latency
  if (data.execution_counters) patch.executionCounters = data.execution_counters
  if (data.analytics) patch.analytics = data.analytics
  if (data.health) patch.health = data.health
  return patch
}

export const useTerminalStore = create<TerminalState>((set) => ({
  ...initial,
  setConnected: (connected) => set({ connected }),
  setWsUrl: (wsUrl) => set({ wsUrl }),
  resetSession: () => set({ ...initial }),
  setSnapshot: (data) => set(statePatch(data)),
  setStats: (data) => set(statePatch(data)),
  addTicks: (ticks, source = 'event') =>
    set((state) => {
      const ids = new Set(state.chartTicks.map((tick) => tick.id))
      const accepted = ticks.filter((tick) => {
        if (
          ids.has(tick.id) ||
          !Number.isFinite(tick.price) ||
          tick.price < 1e-12 ||
          tick.price > 1e12 ||
          !Number.isSafeInteger(tick.ts) ||
          tick.ts < 0 ||
          tick.ts > 4102444800000
        )
          return false
        if (
          tick.size !== undefined &&
          (!Number.isFinite(tick.size) || tick.size < 1e-12 || tick.size > 1e12)
        )
          return false
        ids.add(tick.id)
        return true
      })
      if (!accepted.length) return {}
      return {
        chartTicks: [...state.chartTicks, ...accepted].sort((a, b) => a.ts - b.ts).slice(-10000),
        chartTimestampSource:
          state.chartTicks.length && state.chartTimestampSource !== source ? 'mixed' : source,
      }
    }),
  addTrade: (trade) => set((state) => ({ trades: [...state.trades, trade].slice(-2000) })),
  addLog: (log) => set((state) => ({ logs: [...state.logs, log].slice(-300) })),
  clearLogs: () => set({ logs: [] }),
  setPresets: (presets, customPresets) => set({ presets, customPresets }),
  setModeAck: (data) =>
    set({
      mode: data.mode,
      balance: data.balance,
      executorType: data.executor_type,
      modeSelected: true,
      modeError: null,
    }),
  setModeError: (modeError) => set({ modeError }),
  setPaused: (paused) => set({ paused }),
  setCandidateFeed: (candidateFeed) => set({ candidateFeed: candidateFeed.slice(0, 500) }),
  upsertLiveEntry: (entry) =>
    set((state) => {
      if (state.positions.some((position) => position.mint === entry.mint)) return {}
      const positions = [
        ...state.positions,
        {
          mint: entry.mint,
          name: entry.name,
          symbol: entry.symbol,
          size_sol: entry.size,
          pnl_pct: 0,
          hold_time: 0,
          partial_sold: false,
          is_moonbag: false,
        },
      ]
      return { positions, openPositions: positions.length }
    }),
  removePosition: (mint) =>
    set((state) => {
      const positions = state.positions.filter((position) => position.mint !== mint)
      return { positions, openPositions: positions.length }
    }),
  setValidationResult: (data) =>
    set((state) => ({
      validationResults: {
        ...state.validationResults,
        [data.field]: { status: data.status, message: data.message },
      },
    })),
  addToast: (data) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          id: ++toastId,
          message: data.message,
          level: ['success', 'warning', 'error'].includes(data.level)
            ? (data.level as ToastItem['level'])
            : 'info',
          ttl_ms: data.ttl_ms ?? 4000,
          created_at: Date.now(),
        },
      ].slice(-8),
    })),
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))
