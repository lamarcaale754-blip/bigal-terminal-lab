import { useTerminalStore } from '../../stores/terminalStore'
import { useLinkedContext } from '../../hooks/useLinkedContext'

export function TickerTiles() {
  const candidates = useTerminalStore((s) => s.candidateFeed)
  const setSelectedMint = useLinkedContext((s) => s.setSelectedMint)

  return (
    <div
      style={{
        height: 'var(--ticker-height)',
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        padding: '0 8px',
        overflow: 'hidden',
        background: 'var(--bg-elevated)',
        borderTop: '1px solid var(--bdr)',
      }}
    >
      {candidates.length === 0 ? (
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--muted)',
            fontFamily: 'var(--font-ui)',
          }}
        >
          Waiting for tokens...
        </span>
      ) : (
        candidates.map((c) => {
          const isUp = c.buyers >= 4
          const color = isUp ? 'var(--green)' : 'var(--red)'
          const bg = isUp ? 'var(--green-bg)' : 'var(--red-bg)'
          const borderColor = isUp ? 'var(--green-dim)' : 'var(--red-dim)'

          return (
            <button
              key={c.mint}
              onClick={() => setSelectedMint(c.mint)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px 10px',
                background: bg,
                border: `1px solid ${borderColor}`,
                borderRadius: 'var(--radius-sm)',
                minWidth: 64,
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'transform 0.1s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.05)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
              }}
            >
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  color: 'var(--txt-bright)',
                  lineHeight: 1,
                  maxWidth: 56,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.symbol || c.name?.slice(0, 6) || '???'}
              </span>
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 600,
                  color,
                  lineHeight: 1.4,
                  fontFamily: 'var(--font-data)',
                }}
              >
                {c.buyers}B / {c.vol.toFixed(1)}
              </span>
            </button>
          )
        })
      )}
    </div>
  )
}
