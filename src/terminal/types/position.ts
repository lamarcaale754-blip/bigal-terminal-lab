/** Active position — from Position.to_dict() in bigalbot_customizable.py */
export interface PositionData {
  mint: string
  name: string
  symbol: string
  size_sol: number
  pnl_pct: number
  hold_time: number
  partial_sold: boolean
  is_moonbag: boolean
  closing?: boolean
  entry_price?: number
  last_price?: number
}

/** Candidate token from candidateFeed in stats broadcast */
export interface CandidateData {
  name: string
  symbol: string
  mint: string
  buyers: number
  vol: number
  sell_pct: number
  bc: number
  age: number
  last_price?: number
}

/** Trade event from trade messages */
export interface TradeEvent {
  simulated?: boolean
  execution_confirmed?: boolean
  projected_pnl_sol?: number
  ts?: number
  mint?: string
  time: string
  name: string
  symbol: string
  action: string
  pnl_pct: number
  pnl_sol: number
  cum_pnl: number
}

/** Log entry from log messages */
export interface LogEntry {
  msg: string
  level: string
  time: string
  id: number
}

/** Latency breakdown from executor */
export interface LatencyData {
  zmq_ms: number
  build_ms: number
  land_ms: number
  total_ms: number
}

/** Execution counters from stats broadcast */
export interface ExecutionCounters {
  [key: string]: number
}

/** Analytics data from stats broadcast */
export interface AnalyticsData {
  total_pnl_sol?: number
  total_fees_sol?: number
  win_rate?: number
  avg_pnl_pct?: number
  by_reason?: Record<string, { wins: number; losses: number; avg_pnl: number }>
  by_hour?: Record<string, { trades: number; pnl: number }>
}

/** Startup hints from snapshot */
export interface StartupHints {
  available_modes?: string[]
  source?: string
  helius_ready?: boolean
  keypair_file?: boolean
  grpc_ready?: boolean
  grpc_token_ready?: boolean
  jito_ready?: boolean
  wallet_env?: boolean
  env_file?: boolean
  os_name?: string
  python_version?: string
  node_version?: string
  dashboard_url?: string
  ws_url?: string
}

/** Preset definition */
export interface PresetMap {
  [name: string]: Partial<Record<string, number | boolean | string>>
}
