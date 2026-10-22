import { useTerminalStore } from '../../stores/terminalStore'
import { useLinkedContext } from '../../hooks/useLinkedContext'
import { truncAddr } from '../../lib/formatting'

export function CandidatesGrid() {
  const candidates = useTerminalStore((s) => s.candidateFeed)
  const setSelectedMint = useLinkedContext((s) => s.setSelectedMint)

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
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Symbol', 'Buyers', 'Vol', 'Sell%', 'BC%', 'Age'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '3px 6px',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 500,
                    color: 'var(--muted)',
                    textAlign: h === 'Symbol' ? 'left' : 'right',
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
            {candidates.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    padding: 24,
                    textAlign: 'center',
                    color: 'var(--muted)',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  Scanning for candidates...
                </td>
              </tr>
            ) : (
              candidates.map((c) => (
                <tr
                  key={c.mint}
                  onClick={() => setSelectedMint(c.mint)}
                  tabIndex={0}
                  aria-label={`Chart ${c.symbol || c.mint}`}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      setSelectedMint(c.mint)
                    }
                  }}
                  style={{
                    cursor: 'pointer',
                    height: 'var(--row-height)',
                    borderBottom: '1px solid var(--bdr)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--card-hover)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <td
                    style={{
                      padding: '0 6px',
                      color: 'var(--txt-bright)',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span title={c.mint}>{c.symbol || truncAddr(c.mint, 3)}</span>
                  </td>
                  <td
                    style={{
                      padding: '0 6px',
                      textAlign: 'right',
                      fontFamily: 'var(--font-data)',
                      color: c.buyers >= 6 ? 'var(--green)' : 'var(--txt)',
                      fontWeight: c.buyers >= 6 ? 600 : 400,
                    }}
                  >
                    {c.buyers}
                  </td>
                  <td
                    style={{ padding: '0 6px', textAlign: 'right', fontFamily: 'var(--font-data)' }}
                  >
                    {c.vol.toFixed(2)}
                  </td>
                  <td
                    style={{
                      padding: '0 6px',
                      textAlign: 'right',
                      fontFamily: 'var(--font-data)',
                      color: c.sell_pct > 50 ? 'var(--red)' : 'var(--txt)',
                    }}
                  >
                    {c.sell_pct.toFixed(0)}%
                  </td>
                  <td
                    style={{
                      padding: '0 6px',
                      textAlign: 'right',
                      fontFamily: 'var(--font-data)',
                      color: c.bc > 80 ? 'var(--cyan)' : 'var(--txt)',
                    }}
                  >
                    {c.bc.toFixed(1)}
                  </td>
                  <td
                    style={{
                      padding: '0 6px',
                      textAlign: 'right',
                      fontFamily: 'var(--font-data)',
                      color: 'var(--dim)',
                    }}
                  >
                    {c.age.toFixed(0)}s
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
