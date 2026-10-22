import { create } from 'zustand'
import type { ConfigDict } from '../types/config'

/**
 * Separate config store for render isolation.
 * Config slider drags are 60fps local, 80ms debounced WS sends.
 * Isolating prevents full terminal re-render on slider drag.
 */

/** Track pending keys to suppress re-broadcast of own changes */
const pendingKeys = new Map<string, { value: unknown; expires: number }>()
const PENDING_TTL = 500 // ms

export function markPending(key: string, value: unknown) {
  pendingKeys.set(key, { value, expires: Date.now() + PENDING_TTL })
}

export function isPending(key: string, value: unknown): boolean {
  const entry = pendingKeys.get(key)
  if (!entry) return false
  if (Date.now() > entry.expires) {
    pendingKeys.delete(key)
    return false
  }
  return entry.value === value
}

function cleanPending() {
  const now = Date.now()
  for (const [key, entry] of pendingKeys) {
    if (now > entry.expires) pendingKeys.delete(key)
  }
}

interface ConfigState {
  config: ConfigDict
  setConfig: (config: ConfigDict) => void
  updateKey: (key: string, value: unknown) => void
}

const DEFAULT_CONFIG: ConfigDict = {
  tp1: 12,
  tp2: 25,
  sl: 15,
  max_hold: 60,
  trail_min: 10,
  trail_peak: 5,
  entry_buyers: 4,
  entry_vol: 0.8,
  sell_ratio: 0.5,
  net_buy: 0.15,
  bc_min: 0.5,
  bc_max: 22,
  max_pump: 80,
  min_age: 2,
  min_pool: 0.3,
  manual_entry_progress: 0.5,
  candidate_age: 60,
  max_positions: 10,
  trade_size: 0.05,
  cooldown_losses: 8,
  cooldown_sec: 10,
  moonbag_pct: 0,
  moonbag_expire: 0,
  moonbag_sl: 0,
  moonbag_trail: 0,
  velocity_check: 0,
  velocity_drop: 0,
  dev_dump_panic_enabled: false,
  dev_dump_min_sol: 0,
  dev_dump_min_pct_position: 0,
  anti_manip: 0,
  min_wallet_diversity: 0,
  max_repeat_wallets: 0,
  random_skip_pct: 0,
  strategy_mode: 'manual',
  manual_tip: 0,
  max_tip_sol: 0.01,
  tip_pct_of_notional: 0,
  single_exit_under_sol: 0,
  min_live_exit_sol: 0,
  min_live_tp1_exit_sol: 0,
  force_skip_micro_sells: 0,
  force_full_exit: false,
  dynamic_hold_enabled: true,
  volume_exit_enabled: true,
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: { ...DEFAULT_CONFIG },

  setConfig: (incoming) => {
    cleanPending()
    set((state) => {
      // Only update keys that aren't pending (our own outgoing change)
      const merged = { ...state.config }
      for (const [key, value] of Object.entries(incoming)) {
        if (!isPending(key, value)) {
          merged[key] = value
        }
      }
      return { config: merged }
    })
  },

  updateKey: (key, value) => {
    set((state) => ({
      config: { ...state.config, [key]: value },
    }))
  },
}))
