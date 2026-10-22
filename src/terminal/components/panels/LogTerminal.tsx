import { useRef, useEffect, useState } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { getHealthColor } from '../../types/health'

const LEVEL_COLORS: Record<string, string> = {
  info: 'var(--dim)',
  entry: 'var(--cyan)',
  'exit-win': 'var(--green)',
  'exit-loss': 'var(--red)',
  exit: 'var(--txt)',
  warn: 'var(--orange)',
  error: 'var(--red)',
  success: 'var(--green)',
}

const HEALTH_COLORS: Record<string, string> = {
  green: 'var(--green)',
  yellow: 'var(--orange)',
  red: 'var(--red)',
  unknown: 'var(--muted)',
}

export function LogTerminal() {
  const logs = useTerminalStore((s) => s.logs)
  const health = useTerminalStore((s) => s.health)
  const connected = useTerminalStore((s) => s.connected)
  const isPreview = useTerminalStore((s) => s.mode.toUpperCase().includes('PREVIEW'))

  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  // Detect manual scroll — if user scrolls up, pause auto-scroll
  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        overflow: 'hidden',
        minHeight: 0,
        flex: 1,
        height: '100%',
      }}
    >
      {/* Connection status header */}
      <div
        style={{
          height: 24,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          borderBottom: '1px solid var(--bdr-panel)',
          gap: 6,
          flexShrink: 0,
        }}
      >
        {!isPreview && health.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {health.map((ep) => {
              const color = HEALTH_COLORS[getHealthColor(ep)]
              return (
                <span
                  key={ep.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 9,
                    fontFamily: 'var(--font-data)',
                    color: 'var(--dim)',
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: color,
                      flexShrink: 0,
                      boxShadow: ep.healthy ? `0 0 3px ${color}` : 'none',
                    }}
                  />
                  <span style={{ color: ep.healthy ? 'var(--txt)' : 'var(--dim)' }}>{ep.name}</span>
                  {ep.healthy && Number.isFinite(ep.latency_ms) && (
                    <span style={{ color }}>{ep.latency_ms}ms</span>
                  )}
                </span>
              )
            })}
          </div>
        ) : (
          <span
            style={{
              fontSize: 9,
              color: 'var(--muted)',
              fontFamily: 'var(--font-data)',
            }}
          >
            {isPreview
              ? 'synthetic preview · no backend'
              : connected
                ? 'awaiting health data'
                : 'disconnected'}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {!autoScroll && (
          <button
            onClick={() => setAutoScroll(true)}
            style={{
              fontSize: 9,
              color: 'var(--cyan)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-data)',
            }}
          >
            ↓ latest
          </button>
        )}
        <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--font-data)' }}>
          {logs.length}
        </span>
      </div>

      {/* Log entries — newest at bottom, auto-scrolls down */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: '4px 8px',
          fontSize: 'var(--text-sm)',
          lineHeight: '18px',
          fontFamily: 'var(--font-data)',
        }}
      >
        {logs.map((log) => (
          <div key={log.id} style={{ display: 'flex', gap: 6 }}>
            <span style={{ color: 'var(--muted)', flexShrink: 0 }}>{log.time}</span>
            <span style={{ color: LEVEL_COLORS[log.level] || 'var(--dim)' }}>{log.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
