/** Format SOL amount with appropriate precision */
export function fmtSol(value: number, decimals = 4): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) < 0.0001) return '0.0000'
  return value.toFixed(decimals)
}

/** Format percentage */
export function fmtPct(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`
}

/** Format latency in ms */
export function fmtMs(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value === 0) return '0ms'
  if (value < 1) return '<1ms'
  return `${Math.round(value)}ms`
}

/** Format hold time in seconds */
export function fmtHoldTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${seconds.toFixed(0)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

/** Truncate mint/wallet address */
export function truncAddr(addr: string, chars = 4): string {
  if (!addr || addr.length <= chars * 2 + 2) return addr
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`
}

/** Format large numbers with K/M suffixes */
export function fmtCompact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toFixed(0)
}

/** Color class based on PnL */
export function pnlColor(value: number): string {
  if (value > 0) return 'var(--green)'
  if (value < 0) return 'var(--red)'
  return 'var(--dim)'
}
