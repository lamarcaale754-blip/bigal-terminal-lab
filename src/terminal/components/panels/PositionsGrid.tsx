import { useCallback } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useLinkedContext } from '../../hooks/useLinkedContext'
import { fmtSol, fmtPct, fmtHoldTime, pnlColor } from '../../lib/formatting'
import type { WSOutgoing } from '../../types/ws'

/* Position and wallet monitoring. */
export function PositionsGrid({ send }: { send: (msg: WSOutgoing) => void }) {
  const positions = useTerminalStore((s) => s.positions)
  const setSelectedMint = useLinkedContext((s) => s.setSelectedMint)

  const handleSell = useCallback(
    (mint: string, e: React.MouseEvent) => {
      e.stopPropagation()
      send({ type: 'manual_sell', mint })
    },
    [send],
  )

  const totalPnl = positions.reduce((sum, p) => sum + (p.pnl_pct * p.size_sol) / 100, 0)
  const totalSize = positions.reduce((sum, p) => sum + p.size_sol, 0)
  const totalPnlPct = totalSize > 0 ? (totalPnl / totalSize) * 100 : 0

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)' }}>
              {/* Position and wallet monitoring. */}
              <TH sticky>Symbol</TH>
              <TH right>Size SOL</TH>
              <TH right>PnL %</TH>
              <TH right>PnL SOL</TH>
              <TH right>Hold</TH>
              <TH>Type</TH>
              {/* Position and wallet monitoring. */}
              <TH style={{ width: 'var(--col-action)' }}></TH>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    padding: 20,
                    textAlign: 'center',
                    color: 'var(--dim)',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  No open positions
                </td>
              </tr>
            ) : (
              positions.map((p) => (
                <tr
                  key={p.mint}
                  onClick={() => setSelectedMint(p.mint)}
                  style={{
                    cursor: 'pointer',
                    height: 'var(--row-height)',
                    borderBottom: '1px solid var(--bdr)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--card-hover)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = ''
                  }}
                >
                  {/* Position and wallet monitoring. */}
                  <TD
                    style={{
                      position: 'sticky',
                      left: 0,
                      background: 'inherit',
                      zIndex: 1,
                      fontWeight: 600,
                      color: 'var(--txt-bright)',
                    }}
                  >
                    <span title={`${p.name}\n${p.mint}`}>
                      {p.symbol || p.name?.slice(0, 8) || p.mint.slice(0, 6)}
                    </span>
                  </TD>
                  <TD right mono>
                    {fmtSol(p.size_sol, 3)}
                  </TD>
                  <TD right mono style={{ color: pnlColor(p.pnl_pct), fontWeight: 600 }}>
                    {fmtPct(p.pnl_pct)}
                  </TD>
                  <TD right mono style={{ color: pnlColor(p.pnl_pct) }}>
                    {fmtSol((p.pnl_pct * p.size_sol) / 100)}
                  </TD>
                  <TD right mono style={{ color: 'var(--dim)' }}>
                    {fmtHoldTime(p.hold_time)}
                  </TD>
                  <TD>
                    <span
                      style={{
                        fontSize: 9,
                        padding: '1px 4px',
                        borderRadius: 2,
                        background: p.is_moonbag ? 'var(--purple-bg)' : 'var(--blue-bg)',
                        color: p.is_moonbag ? 'var(--purple)' : 'var(--blue)',
                        fontWeight: 500,
                      }}
                    >
                      {p.is_moonbag ? 'MB' : 'POS'}
                    </span>
                  </TD>
                  {/* Position and wallet monitoring. */}
                  <TD style={{ width: 'var(--col-action)' }}>
                    <button
                      onClick={(e) => handleSell(p.mint, e)}
                      aria-label={`Sell ${p.symbol || p.name || p.mint}`}
                      disabled={!!p.closing}
                      style={{
                        padding: '2px 8px',
                        background: p.closing ? 'var(--bg-elevated)' : 'var(--rbg)',
                        border: p.closing ? '1px solid var(--bdr)' : '1px solid var(--rbdr)',
                        borderRadius: 'var(--radius-sm)',
                        color: p.closing ? 'var(--muted)' : 'var(--red)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 600,
                        fontFamily: 'var(--font-ui)',
                        cursor: p.closing ? 'default' : 'pointer',
                      }}
                    >
                      {p.closing ? 'SELLING' : 'SELL'}
                    </button>
                  </TD>
                </tr>
              ))
            )}
          </tbody>
          {/* Open-position mark-to-market totals, separate from realized trade PnL. */}
          {positions.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--bdr)', background: 'var(--bg-elevated)' }}>
                <TD
                  style={{
                    fontWeight: 600,
                    color: 'var(--txt-bright)',
                    position: 'sticky',
                    left: 0,
                    background: 'var(--bg-elevated)',
                    zIndex: 1,
                  }}
                >
                  Totals
                </TD>
                <TD right mono style={{ fontWeight: 600 }}>
                  {fmtSol(totalSize, 3)}
                </TD>
                <TD right mono style={{ color: pnlColor(totalPnl), fontWeight: 600 }}>
                  {fmtPct(totalPnlPct)}
                </TD>
                <TD right mono style={{ color: pnlColor(totalPnl), fontWeight: 600 }}>
                  {fmtSol(totalPnl)}
                </TD>
                <TD style={{ color: 'var(--muted)', fontSize: 8 }} colSpan={2}>
                  UNREALIZED
                </TD>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

/** Table header cell */
function TH({
  children,
  right,
  sticky,
  style,
}: {
  children?: React.ReactNode
  right?: boolean
  sticky?: boolean
  style?: React.CSSProperties
}) {
  return (
    <th
      style={{
        padding: '4px 6px',
        fontSize: 'var(--text-xs)',
        fontWeight: 500,
        color: 'var(--dim)',
        textAlign: right ? 'right' : 'left',
        borderBottom: '1px solid var(--bdr)',
        fontFamily: 'var(--font-ui)',
        textTransform: 'uppercase',
        letterSpacing: '0.3px',
        whiteSpace: 'nowrap',
        position: sticky ? 'sticky' : undefined,
        left: sticky ? 0 : undefined,
        zIndex: sticky ? 2 : undefined,
        background: 'var(--bg-elevated)',
        ...style,
      }}
    >
      {children}
    </th>
  )
}

/** Table data cell */
function TD({
  children,
  right,
  mono,
  style,
  colSpan,
}: {
  children?: React.ReactNode
  right?: boolean
  mono?: boolean
  style?: React.CSSProperties
  colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: '0 6px',
        textAlign: right ? 'right' : 'left',
        fontFamily: mono ? 'var(--font-data)' : 'var(--font-ui)',
        fontSize: 'var(--text-sm)',
        fontFeatureSettings: mono ? '"tnum" 1' : undefined,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </td>
  )
}
