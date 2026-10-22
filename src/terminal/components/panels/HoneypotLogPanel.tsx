import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'

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

const HP_FILTER = /honeypot|blocked/i

export function HoneypotLogPanel() {
  const logs = useTerminalStore((s) => s.logs)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const filtered = useMemo(() => logs.filter((l) => HP_FILTER.test(l.msg)), [logs])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filtered.length, autoScroll])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40)
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      {/* Header bar */}
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
        <span
          style={{
            fontSize: 9,
            fontFamily: 'var(--font-ui)',
            color: 'var(--dim)',
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
            fontWeight: 600,
          }}
        >
          Honeypot Events
        </span>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-data)', color: 'var(--muted)' }}>
          {filtered.length}
        </span>
        <div style={{ flex: 1 }} />
        {!autoScroll && (
          <button
            onClick={() => {
              setAutoScroll(true)
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
            }}
            style={{
              fontSize: 9,
              color: 'var(--accent)',
              padding: '1px 6px',
              borderRadius: 2,
              border: '1px solid var(--accent)',
              fontFamily: 'var(--font-ui)',
            }}
          >
            Scroll to bottom
          </button>
        )}
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '4px 8px',
          fontSize: 11,
          lineHeight: '18px',
          fontFamily: 'var(--font-data)',
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'var(--dim)',
              fontSize: 11,
            }}
          >
            No honeypot events yet
          </div>
        ) : (
          filtered.map((log) => (
            <div
              key={log.id}
              style={{
                display: 'flex',
                gap: 6,
                height: 24,
                alignItems: 'center',
                borderBottom: '1px solid var(--bdr-panel)',
              }}
            >
              <span
                style={{
                  color: 'var(--muted)',
                  flexShrink: 0,
                  fontSize: 10,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {log.time}
              </span>
              <span style={{ color: LEVEL_COLORS[log.level] || 'var(--dim)' }}>{log.msg}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
