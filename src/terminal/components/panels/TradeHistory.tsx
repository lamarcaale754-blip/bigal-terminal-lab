import { useRef, useEffect } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { fmtPct, fmtSol, pnlColor } from '../../lib/formatting'
import { WinBadge, LossBadge } from '../shared/Badge'
import { pnlLabels } from '../../lib/chartData'

export function TradeHistory() {
  const trades = useTerminalStore((s) => s.trades)
  const mode = useTerminalStore((s) => s.mode)
  const labels = pnlLabels(mode)
  const isLive = mode.toUpperCase().includes('LIVE')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [trades.length])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto' }}>
        <table
          style={{ width: '100%', borderCollapse: 'collapse' }}
          aria-label={`${labels.title} trade history`}
          title={labels.description}
        >
          <thead>
            <tr>
              {[
                'Time',
                'Name',
                '',
                isLive ? 'Est. PnL%' : 'Sim. PnL%',
                isLive ? 'Est. SOL' : 'Sim. SOL',
                'Cum',
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '3px 6px',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 500,
                    color: 'var(--muted)',
                    textAlign: h === 'Time' || h === 'Name' || h === '' ? 'left' : 'right',
                    borderBottom: '1px solid var(--bdr)',
                    position: 'sticky',
                    top: 0,
                    background: 'var(--bg)',
                    fontFamily: 'var(--font-ui)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.slice(-100).map((t, i) => (
              <tr
                key={i}
                style={{
                  height: 'var(--row-height)',
                  borderBottom: '1px solid var(--bdr)',
                }}
              >
                <td style={{ padding: '0 6px', color: 'var(--dim)', fontSize: 'var(--text-xs)' }}>
                  {t.time}
                </td>
                <td style={{ padding: '0 6px', color: 'var(--txt-bright)', fontWeight: 500 }}>
                  {t.symbol || t.name}
                </td>
                <td style={{ padding: '0 6px' }}>
                  {!Number.isFinite(t.pnl_sol) ? (
                    <span title="Outcome unavailable">—</span>
                  ) : t.pnl_sol >= 0 ? (
                    <WinBadge />
                  ) : (
                    <LossBadge />
                  )}
                </td>
                <td
                  style={{
                    padding: '0 6px',
                    textAlign: 'right',
                    color: pnlColor(t.pnl_pct),
                    fontWeight: 600,
                  }}
                >
                  {fmtPct(t.pnl_pct)}
                </td>
                <td style={{ padding: '0 6px', textAlign: 'right', color: pnlColor(t.pnl_sol) }}>
                  {fmtSol(t.pnl_sol)}
                </td>
                <td
                  style={{
                    padding: '0 6px',
                    textAlign: 'right',
                    color: pnlColor(t.cum_pnl),
                    fontWeight: 500,
                  }}
                >
                  {fmtSol(t.cum_pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
