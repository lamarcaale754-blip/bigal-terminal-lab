import type { ConfigDict } from './config'
import type {
  PositionData,
  CandidateData,
  TradeEvent,
  LatencyData,
  ExecutionCounters,
  AnalyticsData,
  StartupHints,
  PresetMap,
} from './position'
import type { EndpointHealth } from './health'

/** Optional fields are patches. A missing array must not erase the last snapshot. */
export interface TerminalPayload {
  balance?: number
  pnl?: number
  projected_pnl?: number
  actual_wallet_pnl?: number | null
  wins?: number
  losses?: number
  win_rate?: number
  open_positions?: number
  moonbag_count?: number
  candidate_count?: number
  blacklisted?: number
  consecutive_losses?: number
  cooldown_remaining?: number
  chain_balance?: number | null
  wallet_delta_sol?: number | null
  positions?: PositionData[]
  candidate_feed?: CandidateData[]
  trade_history?: TradeEvent[]
  config?: Partial<ConfigDict>
  presets?: PresetMap
  custom_presets?: string[]
  mode?: string
  executor_type?: string
  paused?: boolean
  startup_hints?: StartupHints
  latency?: LatencyData
  execution_counters?: ExecutionCounters
  analytics?: AnalyticsData
  blockhash_age?: number
  health?: EndpointHealth[]
  server_time_ms?: number
}

export type ModeSelectPayload = { type: 'mode_select'; mode: 'paper' | 'legacy' | 'zmq_rust' }
export type WSOutgoing =
  | { type: 'connect'; url: string }
  | { type: 'disconnect' }
  | { type: 'demo_start' }
  | { type: 'config_update'; data: Partial<ConfigDict> }
  | { type: 'preset'; name: string }
  | { type: 'save_preset'; name: string; data: Partial<ConfigDict> }
  | { type: 'delete_preset'; name: string }
  | { type: 'manual_sell'; mint: string }
  | { type: 'pause_trading'; paused: boolean }
  | { type: 'prepare_mode_switch' }
  | ModeSelectPayload
  | { type: 'terminate_bot' }
