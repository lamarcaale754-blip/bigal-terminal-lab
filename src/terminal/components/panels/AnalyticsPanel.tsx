import { useTerminalStore } from '../../stores/terminalStore'

export function AnalyticsPanel() {
  const executionCounters = useTerminalStore((s) => s.executionCounters)
  const analytics = useTerminalStore((s) => s.analytics)
  const blockhashAge = useTerminalStore((s) => s.blockhashAge)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {/* Blockhash freshness */}
        <StatRow
          label="Blockhash Age"
          value={blockhashAge ? `${blockhashAge.toFixed(0)}ms` : '--'}
          color={
            !Number.isFinite(blockhashAge)
              ? 'var(--muted)'
              : blockhashAge < 500
                ? 'var(--green)'
                : blockhashAge < 2000
                  ? 'var(--orange)'
                  : 'var(--red)'
          }
        />

        {/* Analytics by reason */}
        {analytics?.by_reason && (
          <>
            <div
              style={{
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-ui)',
                fontWeight: 700,
                color: 'var(--accent)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginTop: 12,
                marginBottom: 6,
                borderBottom: '1px solid var(--bdr)',
                paddingBottom: 3,
              }}
            >
              Exit Reasons
            </div>
            {Object.entries(analytics.by_reason).map(([reason, data]) => (
              <div
                key={reason}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '2px 0',
                  fontSize: 'var(--text-xs)',
                }}
              >
                <span style={{ color: 'var(--dim)' }}>{reason}</span>
                <span style={{ color: data.wins > data.losses ? 'var(--green)' : 'var(--red)' }}>
                  {data.wins}W/{data.losses}L ({data.avg_pnl?.toFixed(1)}%)
                </span>
              </div>
            ))}
          </>
        )}

        {/* Execution counters */}
        {Object.keys(executionCounters).length > 0 && (
          <>
            <div
              style={{
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-ui)',
                fontWeight: 700,
                color: 'var(--accent)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginTop: 12,
                marginBottom: 6,
                borderBottom: '1px solid var(--bdr)',
                paddingBottom: 3,
              }}
            >
              Execution Stats
            </div>
            {Object.entries(executionCounters)
              .filter(([, v]) => v > 0)
              .sort(([, a], [, b]) => b - a)
              .map(([key, count]) => (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '2px 0',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  <span style={{ color: 'var(--dim)' }}>{key.replace(/_/g, ' ')}</span>
                  <span style={{ color: key.includes('fail') ? 'var(--red)' : 'var(--txt)' }}>
                    {count}
                  </span>
                </div>
              ))}
          </>
        )}
      </div>
    </div>
  )
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '3px 0',
        borderBottom: '1px solid var(--bdr)',
        fontSize: 'var(--text-sm)',
      }}
    >
      <span style={{ color: 'var(--dim)', fontFamily: 'var(--font-ui)', fontWeight: 500 }}>
        {label}
      </span>
      <span style={{ color, fontFamily: 'var(--font-data)', fontWeight: 600 }}>{value}</span>
    </div>
  )
}
