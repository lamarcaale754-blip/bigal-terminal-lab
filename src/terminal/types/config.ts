/** Runtime configuration shared with the local bot. */
export interface ConfigDict {
  // Exit
  tp1: number
  tp2: number
  sl: number
  max_hold: number
  trail_min: number
  trail_peak: number

  // Entry
  entry_buyers: number
  entry_vol: number
  sell_ratio: number
  net_buy: number
  bc_min: number
  bc_max: number
  max_pump: number
  min_age: number
  min_pool: number
  manual_entry_progress: number
  candidate_age: number

  // Risk
  max_positions: number
  trade_size: number
  cooldown_losses: number
  cooldown_sec: number

  // Moonbag
  moonbag_pct: number
  moonbag_expire: number
  moonbag_sl: number
  moonbag_trail: number

  // Velocity
  velocity_check: number
  velocity_drop: number

  // Dev dump panic
  dev_dump_panic_enabled: boolean
  dev_dump_min_sol: number
  dev_dump_min_pct_position: number

  // Anti-manipulation
  anti_manip: number
  min_wallet_diversity: number
  max_repeat_wallets: number
  random_skip_pct: number

  // Strategy
  strategy_mode: 'manual' | 'adaptive' | 'hybrid'
  manual_tip: number
  max_tip_sol: number
  tip_pct_of_notional: number
  single_exit_under_sol: number
  min_live_exit_sol: number
  min_live_tp1_exit_sol: number
  force_skip_micro_sells: number
  force_full_exit: boolean

  // HFT toggles
  dynamic_hold_enabled: boolean
  volume_exit_enabled: boolean

  // Catch-all for additional config keys
  [key: string]: unknown
}

/** Slider groups shared by Settings and Quick Filters. */
export interface SliderDef {
  key: keyof ConfigDict
  label: string
  min: number
  max: number
  step: number
  suffix?: string
}

export const EXIT_SLIDERS: SliderDef[] = [
  { key: 'tp1', label: 'TP1', min: 0, max: 100, step: 0.5, suffix: '%' },
  { key: 'tp2', label: 'TP2', min: 0, max: 200, step: 1, suffix: '%' },
  { key: 'sl', label: 'Stop Loss', min: 0, max: 50, step: 0.5, suffix: '%' },
  { key: 'max_hold', label: 'Max Hold', min: 5, max: 600, step: 5, suffix: 's' },
  { key: 'trail_min', label: 'Trail Min', min: 0, max: 50, step: 0.5, suffix: '%' },
  { key: 'trail_peak', label: 'Trail Peak', min: 0, max: 30, step: 0.5, suffix: '%' },
]

export const ENTRY_SLIDERS: SliderDef[] = [
  { key: 'manual_entry_progress', label: 'Min BC %', min: 0, max: 60, step: 0.5, suffix: '%' },
  { key: 'entry_buyers', label: 'Min Buyers', min: 1, max: 20, step: 1 },
  { key: 'entry_vol', label: 'Min Volume', min: 0, max: 10, step: 0.1, suffix: ' SOL' },
  { key: 'sell_ratio', label: 'Sell Ratio', min: 0, max: 1, step: 0.01 },
  { key: 'net_buy', label: 'Net Buy', min: 0, max: 1, step: 0.01 },
  { key: 'bc_max', label: 'BC Max', min: 0, max: 100, step: 0.5, suffix: '%' },
  { key: 'max_pump', label: 'Max Pump', min: 0, max: 200, step: 1, suffix: '%' },
  { key: 'min_age', label: 'Min Age', min: 0, max: 30, step: 0.5, suffix: 's' },
  { key: 'min_pool', label: 'Min Pool', min: 0, max: 20, step: 0.5, suffix: ' SOL' },
  { key: 'candidate_age', label: 'Track Window', min: 30, max: 900, step: 30, suffix: 's' },
]

export const RISK_SLIDERS: SliderDef[] = [
  { key: 'max_positions', label: 'Max Positions', min: 1, max: 20, step: 1 },
  { key: 'trade_size', label: 'Trade Size', min: 0.001, max: 1.0, step: 0.001, suffix: ' SOL' },
  { key: 'cooldown_losses', label: 'Cooldown Losses', min: 1, max: 20, step: 1 },
  { key: 'cooldown_sec', label: 'Cooldown Time', min: 0, max: 120, step: 1, suffix: 's' },
]

export const MOONBAG_SLIDERS: SliderDef[] = [
  { key: 'moonbag_pct', label: 'Moonbag %', min: 0, max: 100, step: 1, suffix: '%' },
  { key: 'moonbag_expire', label: 'Moonbag Expire', min: 0, max: 600, step: 10, suffix: 's' },
  { key: 'moonbag_sl', label: 'Moonbag SL', min: 0, max: 100, step: 1, suffix: '%' },
  { key: 'moonbag_trail', label: 'Moonbag Trail', min: 0, max: 100, step: 1, suffix: '%' },
]
