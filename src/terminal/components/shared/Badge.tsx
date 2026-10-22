import type { CSSProperties } from 'react'

interface BadgeProps {
  label: string
  color?: string
  bg?: string
  style?: CSSProperties
}

export function Badge({ label, color = 'var(--txt)', bg = 'var(--card2)', style }: BadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-xs)',
        fontWeight: 500,
        color,
        background: bg,
        letterSpacing: '0.3px',
        lineHeight: '16px',
        ...style,
      }}
    >
      {label}
    </span>
  )
}

export function WinBadge() {
  return <Badge label="WIN" color="var(--green)" bg="var(--green-bg)" />
}

export function LossBadge() {
  return <Badge label="LOSS" color="var(--red)" bg="var(--red-bg)" />
}

export function MoonbagBadge() {
  return <Badge label="MB" color="var(--purple)" bg="#b388ff15" />
}

export function PosBadge() {
  return <Badge label="POS" color="var(--cyan)" bg="var(--cyan-dim)" />
}
