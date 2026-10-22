import type { Tick } from './core/types'

export const price = (value: number) =>
  value !== 0 && (Math.abs(value) < 0.0001 || Math.abs(value) >= 1e10)
    ? value.toExponential(4)
    : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
export const number = (value: number) =>
  value !== 0 && (Math.abs(value) < 0.001 || Math.abs(value) >= 1e10)
    ? value.toExponential(3)
    : value.toLocaleString('en-US', { maximumFractionDigits: 3 })
export const utc = (value: number) => new Date(value).toISOString().slice(11, 19)
export function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function summarize(ticks: Tick[]) {
  const groups = new Map<string, Tick[]>()
  for (const tick of ticks) {
    const group = groups.get(tick.symbol)
    if (group) group.push(tick)
    else groups.set(tick.symbol, [tick])
  }
  return Array.from(groups, ([symbol, events]) => {
    const first = events[0],
      last = events[events.length - 1]
    let high = first.price,
      low = first.price,
      size = 0,
      mean = 0
    const hasVolume = events.every((t) => t.size !== undefined)
    for (const t of events) {
      high = Math.max(high, t.price)
      low = Math.min(low, t.price)
      if (t.size !== undefined) {
        const weight = t.size / (size + t.size)
        mean = mean * (1 - weight) + t.price * weight
        size += t.size
      }
    }
    return {
      symbol,
      first,
      last,
      high,
      low,
      size: hasVolume ? size : null,
      vwap: hasVolume && size > 0 ? mean : null,
      count: events.length,
      change: (last.price / first.price - 1) * 100,
    }
  })
}
