import type { ParseIssue, ParseResult, Tick } from './types'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_RECORDS = 20_000
/** Supported data contract: 1970-01-01 through 2100-01-01 UTC, inclusive. */
export const MIN_TIMESTAMP_MS = 0
export const MAX_TIMESTAMP_MS = 4_102_444_800_000
/** Bounds retain small fractional quantities while keeping aggregates finite. */
export const MIN_OBSERVATION_VALUE = 1e-12
export const MAX_OBSERVATION_VALUE = 1e12

function isSupportedValue(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_OBSERVATION_VALUE &&
    value <= MAX_OBSERVATION_VALUE
  )
}

function normalize(value: unknown): Tick | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'Expected one JSON object per line.'
  }
  const row = value as Record<string, unknown>
  if (
    typeof row.id !== 'string' ||
    row.id.trim().length < 1 ||
    row.id.trim().length > 128 ||
    Array.from(row.id).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) {
    return 'id must be a nonempty string of at most 128 characters without control characters.'
  }
  if (typeof row.symbol !== 'string' || !/^[A-Za-z0-9._-]{1,24}$/.test(row.symbol)) {
    return 'symbol must contain 1–24 letters, digits, dots, underscores, or hyphens.'
  }
  if (
    typeof row.ts !== 'number' ||
    !Number.isSafeInteger(row.ts) ||
    row.ts < MIN_TIMESTAMP_MS ||
    row.ts > MAX_TIMESTAMP_MS
  ) {
    return 'ts must be an integer UTC epoch-millisecond timestamp from 1970-01-01 through 2100-01-01 inclusive.'
  }
  if (!isSupportedValue(row.price))
    return 'price must be a finite number from 1e-12 through 1e12 inclusive.'
  if (row.size !== undefined && !isSupportedValue(row.size))
    return 'size must be a finite number from 1e-12 through 1e12 inclusive when supplied.'
  if (row.side !== undefined && row.side !== 'buy' && row.side !== 'sell')
    return 'side must be buy or sell when supplied.'

  // Deliberately construct an allowlisted object. Imported configuration, URLs,
  // credentials, and arbitrary nested fields never enter application state.
  return {
    id: row.id.trim(),
    ts: row.ts,
    symbol: row.symbol.toUpperCase(),
    price: row.price,
    ...(row.size !== undefined ? { size: row.size as number } : {}),
    ...(row.side !== undefined ? { side: row.side as 'buy' | 'sell' } : {}),
  }
}

function sameObservation(a: Tick, b: Tick): boolean {
  return (
    a.ts === b.ts &&
    a.symbol === b.symbol &&
    a.price === b.price &&
    a.size === b.size &&
    a.side === b.side
  )
}

/** Parse locally, retaining valid observations and reporting rejected rows. */
export function parseJsonl(text: string): ParseResult {
  const fail = (message: string): ParseResult => ({
    ticks: [],
    issues: [{ line: 0, message }],
    duplicateCount: 0,
  })
  // The length guard avoids allocating another giant buffer for oversized input.
  if (
    text.length > MAX_IMPORT_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES
  ) {
    return fail('Import exceeds the 5 MiB UTF-8 size limit.')
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const records = lines.reduce((count, line) => count + (line.trim() ? 1 : 0), 0)
  if (records > MAX_IMPORT_RECORDS) return fail('Import exceeds the 20,000-record limit.')
  if (records === 0) return fail('No records found.')

  const ticks: Tick[] = []
  const issues: ParseIssue[] = []
  const seen = new Map<string, Tick>()
  let duplicateCount = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      issues.push({ line: index + 1, message: 'Invalid JSON.' })
      continue
    }
    const tick = normalize(value)
    if (typeof tick === 'string') {
      issues.push({ line: index + 1, message: tick })
      continue
    }
    const previous = seen.get(tick.id)
    if (previous) {
      duplicateCount++
      if (!sameObservation(previous, tick)) {
        issues.push({
          line: index + 1,
          message: 'Conflicting duplicate id; the first valid observation was retained.',
        })
      }
      continue
    }
    seen.set(tick.id, tick)
    ticks.push(tick)
  }
  // ECMAScript's stable sort preserves source order for equal timestamps.
  ticks.sort((a, b) => a.ts - b.ts)
  return { ticks, issues, duplicateCount }
}
