interface ToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        fontSize: 'var(--text-xs)',
        color: 'var(--dim)',
        fontFamily: 'var(--font-ui)',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}
    >
      <span style={{ minWidth: 72, textAlign: 'right' }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          width: 32,
          height: 16,
          borderRadius: 8,
          background: checked ? 'var(--accent)' : 'var(--muted)',
          position: 'relative',
          transition: 'background 0.15s',
          flexShrink: 0,
          padding: 0,
          border: 0,
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: 'var(--txt-bright)',
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            transition: 'left 0.15s',
          }}
        />
      </button>
    </label>
  )
}
