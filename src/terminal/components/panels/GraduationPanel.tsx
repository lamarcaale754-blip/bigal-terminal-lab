import { memo, useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTerminalStore } from '../../stores/terminalStore'

const GRADUATION_VSOL = 85

export const GraduationPanel = memo(function GraduationPanel() {
  const candidateFeed = useTerminalStore((s) => s.candidateFeed)
  const parentRef = useRef<HTMLDivElement>(null)

  const nearGrad = useMemo(
    () => candidateFeed.filter((c) => c.bc > 60).sort((a, b) => b.bc - a.bc),
    [candidateFeed],
  )

  const virtualizer = useVirtualizer({
    count: nearGrad.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24,
    overscan: 5,
  })

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        fontFamily: 'var(--font-data)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '56px 1fr 100px 48px 56px 42px',
          alignItems: 'center',
          height: 24,
          padding: '0 8px',
          background: 'var(--bg-elevated)',
          borderBottom: '1px solid var(--bdr-panel)',
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        {[
          { label: 'Symbol', align: 'left' },
          { label: 'Name', align: 'left' },
          { label: 'vSOL', align: 'left' },
          { label: 'Buyers', align: 'right' },
          { label: 'Volume', align: 'right' },
          { label: 'Age', align: 'right' },
        ].map((h) => (
          <span
            key={h.label}
            style={{
              fontSize: 9,
              fontWeight: 600,
              fontFamily: 'var(--font-ui)',
              textTransform: 'uppercase',
              letterSpacing: '0.3px',
              color: 'var(--dim)',
              textAlign: h.align as React.CSSProperties['textAlign'],
            }}
          >
            {h.label}
          </span>
        ))}
      </div>

      {/* Body */}
      {nearGrad.length === 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: 'var(--dim)',
            font: '400 11px var(--font-data)',
          }}
        >
          No tokens near graduation
        </div>
      ) : (
        <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const c = nearGrad[vRow.index]
              const pct = Math.min((c.bc / GRADUATION_VSOL) * 100, 100)
              const isHot = c.bc > 75

              return (
                <div
                  key={vRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: vRow.size,
                    transform: `translateY(${vRow.start}px)`,
                    display: 'grid',
                    gridTemplateColumns: '56px 1fr 100px 48px 56px 42px',
                    alignItems: 'center',
                    padding: '0 8px',
                    borderBottom: '1px solid var(--bdr-panel)',
                    fontSize: 11,
                    color: isHot ? 'var(--cyan)' : 'var(--txt)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--card-hover)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = ''
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      color: isHot ? 'var(--cyan)' : 'var(--txt-bright)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.symbol || c.mint.slice(0, 6)}
                  </span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--dim)',
                      paddingRight: 6,
                    }}
                    title={c.name}
                  >
                    {c.name.length > 16 ? c.name.slice(0, 16) + '...' : c.name}
                  </span>
                  {/* Progress bar cell */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 3,
                        background: 'var(--card2)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          borderRadius: 3,
                          background: isHot ? 'var(--cyan)' : 'var(--green)',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        minWidth: 28,
                        textAlign: 'right',
                        fontWeight: isHot ? 600 : 400,
                      }}
                    >
                      {c.bc.toFixed(1)}
                    </span>
                  </div>
                  <span
                    style={{
                      textAlign: 'right',
                      color: c.buyers >= 6 ? 'var(--green)' : 'var(--txt)',
                    }}
                  >
                    {c.buyers}
                  </span>
                  <span style={{ textAlign: 'right' }}>{c.vol.toFixed(1)}</span>
                  <span style={{ textAlign: 'right', color: 'var(--dim)' }}>
                    {c.age.toFixed(0)}s
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
})
