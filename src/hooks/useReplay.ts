import { useEffect, useMemo, useState } from 'react'
import type { Tick } from '../core/types'

/** Replay is driven by event time. A seek reconstructs the same prefix every time. */
export function useReplay(ticks: Tick[], preview: boolean) {
  const start = ticks[0]?.ts ?? 0
  const end = ticks.at(-1)?.ts ?? start
  const [frame, setFrame] = useState({
    time: preview ? start + (end - start) * 0.65 : start,
    playing: false,
  })
  const [speed, setSpeed] = useState(20)
  useEffect(() => {
    if (!frame.playing) return
    let previous = performance.now()
    const timer = window.setInterval(() => {
      const now = performance.now()
      const elapsed = now - previous
      previous = now
      setFrame((current) => {
        if (!current.playing) return current
        const time = Math.min(end, current.time + elapsed * speed)
        return { time, playing: time < end }
      })
    }, 100)
    return () => window.clearInterval(timer)
  }, [frame.playing, speed, end])
  const visible = useMemo(() => {
    let low = 0,
      high = ticks.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (ticks[mid].ts <= frame.time) low = mid + 1
      else high = mid
    }
    return ticks.slice(0, low)
  }, [ticks, frame.time])
  return {
    ...frame,
    start,
    end,
    visible,
    speed,
    setSpeed,
    toggle: () =>
      setFrame((current) =>
        current.time >= end
          ? { time: start, playing: true }
          : { ...current, playing: !current.playing },
      ),
    seek: (time: number) =>
      setFrame({ time: Math.max(start, Math.min(end, time)), playing: false }),
    step: () =>
      setFrame((current) => ({
        time: ticks.find((t) => t.ts > current.time)?.ts ?? end,
        playing: false,
      })),
  }
}
