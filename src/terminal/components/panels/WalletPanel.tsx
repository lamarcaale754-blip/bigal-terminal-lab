import { useState } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { fmtSol, fmtPct, pnlColor } from '../../lib/formatting'
import { pnlLabels } from '../../lib/chartData'

/* Position and wallet monitoring. */

type Tab = 'overview' | 'transactions'

export function WalletPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  const balance = useTerminalStore((s) => s.balance)
  const chainBalance = useTerminalStore((s) => s.chainBalance)
  const pnl = useTerminalStore((s) => s.pnl)
  const mode = useTerminalStore((s) => s.mode)
  const walletDeltaSol = useTerminalStore((s) => s.walletDeltaSol)
  const wins = useTerminalStore((s) => s.wins)
  const losses = useTerminalStore((s) => s.losses)
  const analytics = useTerminalStore((s) => s.analytics)
  const trades = useTerminalStore((s) => s.trades)

  if (!open) return null

  const totalFees = analytics?.total_fees_sol ?? NaN
  const averagePnl = analytics?.avg_pnl_pct ?? NaN
  const isLive = mode.toUpperCase().includes('LIVE')
  const isPreview = mode.toUpperCase().includes('PREVIEW')
  const labels = pnlLabels(mode)
  const shownBalance = isLive ? chainBalance : balance
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 1400,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 420,
          height: '100%',
          background: 'var(--card)',
          borderLeft: '1px solid var(--bdr2)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
          animation: 'slideInRight 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid var(--bdr)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M16 10h4v4h-4z" />
            </svg>
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontWeight: 600,
                fontSize: 'var(--text-md)',
                color: 'var(--txt-bright)',
              }}
            >
              Wallet
            </span>
          </div>
          <button onClick={onClose} style={{ color: 'var(--dim)', fontSize: 14 }}>
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--bdr)' }}>
          {(['overview', 'transactions'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: '7px 0',
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-ui)',
                fontWeight: tab === t ? 600 : 400,
                color: tab === t ? 'var(--accent)' : 'var(--dim)',
                borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>
          {tab === 'overview' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Balance card */}
              <div
                style={{
                  padding: '14px',
                  background: 'var(--bg)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--bdr)',
                }}
              >
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--dim)',
                    fontFamily: 'var(--font-ui)',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: 6,
                  }}
                >
                  {isLive
                    ? 'On-chain SOL balance'
                    : isPreview
                      ? 'Preview cash balance'
                      : 'Paper cash balance'}
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-2xl)',
                    color: 'var(--txt-primary)',
                    fontWeight: 700,
                    fontFamily: 'var(--font-data)',
                    fontFeatureSettings: '"tnum" 1',
                  }}
                >
                  {fmtSol(shownBalance)}{' '}
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--dim)' }}>SOL</span>
                </div>
                {isLive && Number.isFinite(walletDeltaSol) && (
                  <div
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: pnlColor(walletDeltaSol),
                      marginTop: 2,
                    }}
                  >
                    {walletDeltaSol >= 0 ? '+' : ''}
                    {fmtSol(walletDeltaSol)} since session start
                  </div>
                )}
              </div>

              {/* Position and wallet monitoring. */}
              <div>
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--dim)',
                    fontFamily: 'var(--font-ui)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: 8,
                  }}
                >
                  Session P&L Breakdown
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <PnlRow label={labels.title} value={pnl} bold />
                  <PnlRow
                    label={isLive ? 'Reported execution fees' : 'Reported modeled fees'}
                    value={-totalFees}
                    sub
                  />
                  {isLive && (
                    <>
                      <div style={{ height: 1, background: 'var(--bdr)', margin: '4px 0' }} />
                      <PnlRow label="Measured wallet balance change" value={walletDeltaSol} />
                    </>
                  )}
                  <div
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--dim)',
                      lineHeight: 1.5,
                      marginTop: 6,
                    }}
                  >
                    {labels.description}.{' '}
                    {isLive
                      ? 'Wallet balance change includes position cash flows, transfers and fees.'
                      : 'Figures describe this simulation only.'}
                    {!Number.isFinite(totalFees) && ' Fee measurements were not reported.'}
                  </div>
                </div>
              </div>

              {/* Stats grid */}
              <div>
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--dim)',
                    fontFamily: 'var(--font-ui)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: 8,
                  }}
                >
                  {isLive ? 'Estimated trade outcomes' : 'Simulated trade outcomes'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <StatCard
                    label="Win Rate"
                    value={`${winRate.toFixed(1)}%`}
                    color={winRate >= 50 ? 'var(--green)' : 'var(--red)'}
                  />
                  <StatCard label="Trades" value={`${wins + losses}`} color="var(--txt)" />
                  <StatCard label="Wins" value={`${wins}`} color="var(--green)" />
                  <StatCard label="Losses" value={`${losses}`} color="var(--red)" />
                  <StatCard
                    label="Avg P&L"
                    value={fmtPct(averagePnl)}
                    color={pnlColor(averagePnl)}
                  />
                  <StatCard
                    label="Total Fees"
                    value={`${fmtSol(totalFees)} SOL`}
                    color="var(--orange)"
                  />
                </div>
              </div>
            </div>
          ) : (
            /* Position and wallet monitoring. */
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Time', 'Token', 'Action', isLive ? 'Est. P&L' : 'Sim. P&L', 'Cum'].map(
                      (h) => (
                        <th
                          key={h}
                          style={{
                            padding: '4px 6px',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 500,
                            color: 'var(--muted)',
                            textAlign: h.endsWith('P&L') || h === 'Cum' ? 'right' : 'left',
                            borderBottom: '1px solid var(--bdr)',
                            position: 'sticky',
                            top: 0,
                            background: 'var(--card)',
                            fontFamily: 'var(--font-ui)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {trades
                    .slice()
                    .reverse()
                    .slice(0, 50)
                    .map((t, i) => (
                      <tr
                        key={i}
                        style={{
                          height: 'var(--row-height)',
                          borderBottom: '1px solid var(--bdr)',
                        }}
                      >
                        <td
                          style={{
                            padding: '0 6px',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--dim)',
                          }}
                        >
                          {t.time}
                        </td>
                        <td
                          style={{
                            padding: '0 6px',
                            color: 'var(--txt-bright)',
                            fontWeight: 500,
                            fontSize: 'var(--text-sm)',
                          }}
                        >
                          {t.symbol || t.name}
                        </td>
                        <td
                          style={{
                            padding: '0 6px',
                            fontSize: 'var(--text-xs)',
                            color: t.pnl_sol >= 0 ? 'var(--green)' : 'var(--red)',
                          }}
                        >
                          {t.action}
                        </td>
                        <td
                          style={{
                            padding: '0 6px',
                            textAlign: 'right',
                            color: pnlColor(t.pnl_sol),
                            fontWeight: 500,
                            fontSize: 'var(--text-sm)',
                          }}
                        >
                          {fmtSol(t.pnl_sol)}
                        </td>
                        <td
                          style={{
                            padding: '0 6px',
                            textAlign: 'right',
                            color: pnlColor(t.cum_pnl),
                            fontSize: 'var(--text-sm)',
                          }}
                        >
                          {fmtSol(t.cum_pnl)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {trades.length === 0 && (
                <div
                  style={{
                    padding: 20,
                    textAlign: 'center',
                    color: 'var(--muted)',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  No transactions yet
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}

function PnlRow({
  label,
  value,
  bold,
  sub,
}: {
  label: string
  value: number
  bold?: boolean
  sub?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '3px 0',
        fontSize: sub ? 'var(--text-xs)' : 'var(--text-sm)',
      }}
    >
      <span
        style={{
          color: sub ? 'var(--muted)' : 'var(--dim)',
          fontFamily: 'var(--font-ui)',
          fontWeight: bold ? 600 : 400,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: pnlColor(value),
          fontFamily: 'var(--font-data)',
          fontWeight: bold ? 700 : 500,
          fontSize: bold ? 'var(--text-md)' : undefined,
        }}
      >
        {value >= 0 ? '+' : ''}
        {fmtSol(value)} SOL
      </span>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        padding: '8px 10px',
        background: 'var(--bg)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--bdr)',
      }}
    >
      <div
        style={{
          fontSize: 7,
          color: 'var(--muted)',
          fontFamily: 'var(--font-ui)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 'var(--text-md)',
          color,
          fontWeight: 600,
          fontFamily: 'var(--font-data)',
          fontFeatureSettings: '"tnum" 1',
        }}
      >
        {value}
      </div>
    </div>
  )
}
