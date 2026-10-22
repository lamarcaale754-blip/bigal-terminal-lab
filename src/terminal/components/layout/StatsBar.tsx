import { useTerminalStore } from '../../stores/terminalStore'
import { fmtSol, pnlColor } from '../../lib/formatting'
import { pnlLabels } from '../../lib/chartData'

export function StatsBar() {
  const pnl = useTerminalStore((s) => s.pnl)
  const mode = useTerminalStore((s) => s.mode)
  const labels = pnlLabels(mode)
  const pnlLabel = mode.toUpperCase().includes('LIVE')
    ? 'EST PNL'
    : mode.toUpperCase().includes('PREVIEW')
      ? 'SYN PNL'
      : 'SIM PNL'
  const winRate = useTerminalStore((s) => s.winRate)
  const wins = useTerminalStore((s) => s.wins)
  const losses = useTerminalStore((s) => s.losses)
  const openPositions = useTerminalStore((s) => s.openPositions)
  const positions = useTerminalStore((s) => s.positions)
  const moonbagCount = useTerminalStore((s) => s.moonbagCount)
  const candidateCount = useTerminalStore((s) => s.candidateCount)
  const blacklisted = useTerminalStore((s) => s.blacklisted)
  const cooldownRemaining = useTerminalStore((s) => s.cooldownRemaining)

  return (
    <div
      style={{
        height: 'var(--stats-height)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        gap: 12,
        background: 'var(--bg)',
        borderBottom: '1px solid var(--bdr)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <Chip
        label={pnlLabel}
        value={`${fmtSol(pnl)}`}
        color={pnlColor(pnl)}
        title={`${labels.title}: ${labels.description}`}
      />
      <Sep />
      <Chip label="W/L" value={`${wins}/${losses}`} />
      <Chip
        label="WR"
        value={`${winRate.toFixed(0)}%`}
        color={winRate >= 50 ? 'var(--green)' : winRate > 0 ? 'var(--red)' : 'var(--dim)'}
      />
      <Sep />
      <Chip
        label="OPEN"
        value={String(Math.max(openPositions, positions.length))}
        color="var(--cyan)"
      />
      <Chip label="MB" value={String(moonbagCount)} color="var(--purple)" />
      <Chip label="CAND" value={String(candidateCount)} />
      <Chip label="BLK" value={String(blacklisted)} color="var(--orange)" />
      {cooldownRemaining > 0 && (
        <>
          <Sep />
          <Chip label="CD" value={`${cooldownRemaining.toFixed(0)}s`} color="var(--red)" />
        </>
      )}
    </div>
  )
}

function Chip({
  label,
  value,
  color = 'var(--txt)',
  title,
}: {
  label: string
  value: string
  color?: string
  title?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }} title={title}>
      <span
        style={{
          fontSize: 7,
          color: 'var(--muted)',
          fontFamily: 'var(--font-ui)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          lineHeight: 1,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 'var(--text-sm)',
          color,
          fontWeight: 500,
          fontFamily: 'var(--font-data)',
          fontFeatureSettings: '"tnum" 1',
          lineHeight: 1,
        }}
      >
        {value}
      </span>
    </div>
  )
}

function Sep() {
  return <div style={{ width: 1, height: 12, background: 'var(--bdr)', flexShrink: 0 }} />
}
