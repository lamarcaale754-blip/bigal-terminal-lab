import { useMemo } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { getHealthColor } from '../../types/health'
import { fmtMs } from '../../lib/formatting'

export function HealthPanel() {
  const health = useTerminalStore((s) => s.health)
  const connected = useTerminalStore((s) => s.connected)
  const mode = useTerminalStore((s) => s.mode)
  const serverTimeMs = useTerminalStore((s) => s.serverTimeMs)
  const isPreview = mode.toUpperCase().includes('PREVIEW')
  const endpoints = useMemo(() => {
    const order = { red: 0, yellow: 1, green: 2, unknown: 3 }
    return [...health].sort((a, b) => order[getHealthColor(a)] - order[getHealthColor(b)])
  }, [health])

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
      <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
        <div
          style={{
            padding: '4px 6px',
            borderBottom: '1px solid var(--bdr)',
            fontSize: 'var(--text-sm)',
            color: isPreview ? 'var(--purple)' : connected ? 'var(--green)' : 'var(--dim)',
          }}
        >
          {isPreview
            ? 'Preview — no network endpoints connected'
            : `Dashboard WebSocket: ${connected ? 'connected' : 'disconnected'}`}
        </div>
        {!isPreview &&
          endpoints.map((ep) => {
            const color = getHealthColor(ep)
            const dotColor =
              color === 'green'
                ? 'var(--green)'
                : color === 'yellow'
                  ? 'var(--orange)'
                  : color === 'red'
                    ? 'var(--red)'
                    : 'var(--muted)'
            return (
              <div
                key={ep.name}
                title={ep.detail || undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 6px',
                  borderBottom: '1px solid var(--bdr)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: dotColor,
                    boxShadow: `0 0 4px ${dotColor}`,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, color: 'var(--txt)' }}>{ep.name}</span>
                <span
                  style={{
                    color: dotColor,
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-data)',
                  }}
                >
                  {Number.isFinite(ep.latency_ms) && ep.latency_ms > 0
                    ? fmtMs(ep.latency_ms)
                    : ep.healthy
                      ? 'OK'
                      : '—'}
                </span>
                {ep.last_error && (
                  <span
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--red)',
                      maxWidth: 120,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={ep.last_error}
                  >
                    {ep.last_error}
                  </span>
                )}
              </div>
            )
          })}
        {!isPreview && endpoints.length === 0 && (
          <div style={{ padding: '6px', color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>
            Backend endpoint health has not been reported.
          </div>
        )}
        {!isPreview && serverTimeMs > 0 && (
          <div style={{ padding: '6px', color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>
            Last server timestamp: {new Date(serverTimeMs).toISOString()}
          </div>
        )}
      </div>
    </div>
  )
}
