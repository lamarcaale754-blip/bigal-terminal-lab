import { useCallback, type CSSProperties } from 'react'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  onChange: (value: number) => void
  style?: CSSProperties
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
  style,
}: SliderProps) {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value)
      onChange(v) // optimistic local update every frame

      // Parent handles debounced WS send
    },
    [onChange],
  )

  // Format display value
  const decimals = Math.min(8, Math.max(0, -Math.floor(Math.log10(step))))
  const display = Number.isFinite(value) ? value.toFixed(decimals) : '—'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...style }}>
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--dim)',
          minWidth: 72,
          textAlign: 'right',
          fontFamily: 'var(--font-ui)',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {label}
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        style={{
          flex: 1,
          height: 4,
          accentColor: 'var(--accent)',
          cursor: 'pointer',
        }}
      />
      <span
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--txt)',
          minWidth: 52,
          textAlign: 'right',
          fontFamily: 'var(--font-data)',
          fontFeatureSettings: '"tnum" 1',
        }}
      >
        {display}
        {suffix}
      </span>
    </div>
  )
}
