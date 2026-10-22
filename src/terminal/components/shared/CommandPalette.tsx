import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import type { WSOutgoing } from '../../types/ws'

interface PaletteAction {
  label: string
  description: string
  action: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  send: (msg: WSOutgoing) => void
}

export function CommandPalette({ open, onClose, send }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const positions = useTerminalStore((s) => s.positions)
  const presets = useTerminalStore((s) => s.presets)
  const paused = useTerminalStore((s) => s.paused)
  const clearLogs = useTerminalStore((s) => s.clearLogs)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [
      {
        label: paused ? 'resume' : 'pause',
        description: paused ? 'Resume trading' : 'Pause trading',
        action: () => send({ type: 'pause_trading', paused: !paused }),
      },
      { label: 'clear logs', description: 'Clear terminal log', action: clearLogs },
    ]

    // Add sell actions for each position
    for (const p of positions) {
      list.push({
        label: `sell ${p.symbol || p.name}`,
        description: `Close position ${p.symbol || p.mint.slice(0, 8)}`,
        action: () => send({ type: 'manual_sell', mint: p.mint }),
      })
    }

    // Add preset actions
    for (const name of Object.keys(presets)) {
      list.push({
        label: `preset ${name}`,
        description: `Load preset: ${name}`,
        action: () => send({ type: 'preset', name }),
      })
    }

    return list
  }, [positions, presets, paused, send, clearLogs])

  const filtered = useMemo(() => {
    if (!query) return actions.slice(0, 10)
    const q = query.toLowerCase()
    return actions
      .filter((a) => a.label.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
      .slice(0, 10)
  }, [actions, query])

  const [selectedIdx, setSelectedIdx] = useState(0)

  const execute = useCallback(
    (action: PaletteAction) => {
      action.action()
      onClose()
    },
    [onClose],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(0, Math.min(i + 1, filtered.length - 1)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && filtered[selectedIdx]) {
        execute(filtered[selectedIdx])
      } else if (e.key === 'Escape') {
        onClose()
      }
    },
    [filtered, selectedIdx, execute, onClose],
  )

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 120,
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{
          width: 480,
          maxWidth: 'calc(100vw - 24px)',
          background: 'var(--card)',
          border: '1px solid var(--bdr2)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelectedIdx(0)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          aria-label="Find a command"
          style={{
            width: '100%',
            padding: '12px 16px',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--bdr)',
            fontSize: 'var(--text-md)',
            color: 'var(--txt-bright)',
            outline: 'none',
            fontFamily: 'var(--font-data)',
          }}
        />
        <div style={{ maxHeight: 300, overflow: 'auto' }}>
          {filtered.map((action, i) => (
            <button
              key={action.label + i}
              onClick={() => execute(action)}
              style={{
                display: 'flex',
                width: '100%',
                border: 0,
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px',
                cursor: 'pointer',
                background: i === selectedIdx ? 'var(--card2)' : 'transparent',
              }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--txt-bright)',
                  fontFamily: 'var(--font-data)',
                }}
              >
                {action.label}
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--dim)' }}>
                {action.description}
              </span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                padding: '16px',
                textAlign: 'center',
                color: 'var(--muted)',
                fontSize: 'var(--text-sm)',
              }}
            >
              No matching commands
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
