import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronRight, Check, Activity } from 'lucide-react'

interface MenuItem {
  id: string
  label: string
  shortcut?: string
  type?: 'toggle' | 'action' | 'separator'
  badge?: number | string
  checked?: boolean
  onClick?: () => void
}

interface LatencyData {
  zmq_ms: number
  build_ms: number
  land_ms: number
  total_ms: number
}

interface MenuBarProps {
  activePanels: string[]
  onTogglePanel: (id: string) => void
  onSetLayout: (panels: string[]) => void
  onToggleSidebar: () => void
  isLive: boolean
  isPreview: boolean
  isPaused: boolean
  isConnected: boolean
  onTogglePause: () => void
  onToggleMode: () => void
  onTerminate?: () => void
  onNewWorkspace?: () => void
  onCommand?: (action: string) => void
  latency: LatencyData
  balance: number
  intelCounts?: {
    nearGraduation?: number
    honeypotBlocked?: number
  }
}

const LAYOUT_PRESETS: Record<string, string[]> = {
  'Quick Trade': ['chart', 'positions'],
  'Full Sniper': ['chart', 'candidates', 'positions', 'log'],
  Surveillance: ['graduation', 'chart', 'candidates', 'honeypotLog'],
  'Command Center': ['chart', 'candidates', 'positions', 'log', 'analytics', 'health'],
}

const ALL_PANELS: { id: string; label: string; shortcut?: string }[] = [
  { id: 'chart', label: 'Chart', shortcut: 'Ctrl+1' },
  { id: 'candidates', label: 'Candidates', shortcut: 'Ctrl+2' },
  { id: 'positions', label: 'Positions', shortcut: 'Ctrl+3' },
  { id: 'log', label: 'Terminal Log', shortcut: 'Ctrl+4' },
  { id: 'tradeHistory', label: 'Trade History', shortcut: 'Ctrl+5' },
  { id: 'tickerBar', label: 'Ticker Bar', shortcut: 'Ctrl+6' },
]

const INTEL_PANELS: {
  id: string
  label: string
  badgeKey: 'honeypotBlocked' | 'nearGraduation'
}[] = [
  { id: 'honeypotLog', label: 'Honeypot Log', badgeKey: 'honeypotBlocked' },
  { id: 'graduation', label: 'Near Graduation', badgeKey: 'nearGraduation' },
]

function DropdownMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      className="menu-dropdown"
      role="menu"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      {items.map((item, i) => {
        if (item.type === 'separator') {
          return <div key={i} className="menu-sep" />
        }
        return (
          <button
            key={item.id}
            className="menu-item"
            role={item.type === 'toggle' ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={item.type === 'toggle' ? item.checked : undefined}
            onClick={() => {
              item.onClick?.()
              if (item.type !== 'toggle') onClose()
            }}
          >
            <span className="menu-item__check">
              {item.checked ? <Check size={12} strokeWidth={3} /> : null}
            </span>
            <span className="menu-item__label">{item.label}</span>
            {item.badge !== undefined && <span className="menu-item__badge">{item.badge}</span>}
            {item.shortcut && <span className="menu-item__shortcut">{item.shortcut}</span>}
          </button>
        )
      })}
    </div>
  )
}

function LatencyPipeline({ latency }: { latency: LatencyData }) {
  const value = (ms: number) => (Number.isFinite(ms) ? ms.toFixed(0) : '—')
  const cls = (ms: number) =>
    !Number.isFinite(ms)
      ? ''
      : ms < 50
        ? 'latency-stage__value--fast'
        : ms < 200
          ? 'latency-stage__value--mid'
          : 'latency-stage__value--slow'

  return (
    <div className="latency-pipeline">
      <div className="latency-stage">
        <span className="latency-stage__label">ZMQ</span>
        <span className={`latency-stage__value ${cls(latency.zmq_ms)}`}>
          {value(latency.zmq_ms)}
        </span>
        <span className="latency-stage__label">ms</span>
      </div>
      <ChevronRight size={12} className="latency-arrow" strokeWidth={2} />
      <div className="latency-stage">
        <span className="latency-stage__label">BUILD</span>
        <span className={`latency-stage__value ${cls(latency.build_ms)}`}>
          {value(latency.build_ms)}
        </span>
        <span className="latency-stage__label">ms</span>
      </div>
      <ChevronRight size={12} className="latency-arrow" strokeWidth={2} />
      <div className="latency-stage">
        <span className="latency-stage__label">LAND</span>
        <span className={`latency-stage__value ${cls(latency.land_ms)}`}>
          {value(latency.land_ms)}
        </span>
        <span className="latency-stage__label">ms</span>
      </div>
      <span className="latency-arrow" style={{ opacity: 0.5, margin: '0 2px' }}>
        |
      </span>
      <div className="latency-stage">
        <span className="latency-stage__label">TOTAL</span>
        <span
          className={`latency-stage__value ${cls(latency.total_ms)}`}
          style={{ color: 'var(--cyan)' }}
        >
          {value(latency.total_ms)}
        </span>
        <span className="latency-stage__label">ms</span>
      </div>
    </div>
  )
}

function Clock() {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString([], { hour12: false }))
  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
      )
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [])
  return (
    <span style={{ color: 'var(--text-tertiary)', font: '400 10px var(--font-mono)' }}>{time}</span>
  )
}

export default function MenuBar({
  activePanels,
  onTogglePanel,
  onSetLayout,
  onToggleSidebar,
  isLive,
  isPreview,
  isPaused,
  isConnected,
  onTogglePause,
  onToggleMode,
  onTerminate,
  latency,
  balance,
  intelCounts = {},
  onNewWorkspace,
  onCommand,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const close = useCallback(() => setOpenMenu(null), [])
  const toggle = useCallback((menu: string) => {
    setOpenMenu((prev) => (prev === menu ? null : menu))
  }, [])

  const viewItems: MenuItem[] = [
    ...ALL_PANELS.map((p) => ({
      id: p.id,
      label: p.label,
      shortcut: p.shortcut,
      type: 'toggle' as const,
      checked: activePanels.includes(p.id),
      onClick: () => onTogglePanel(p.id),
    })),
    { id: 'sep0', label: '', type: 'separator' },
    {
      id: 'advancedChart',
      label: 'Advanced Chart',
      shortcut: 'Ctrl+Shift+C',
      type: 'toggle' as const,
      checked: activePanels.includes('advancedChart'),
      onClick: () => onTogglePanel('advancedChart'),
    },
    {
      id: 'filters',
      label: 'Quick Filters',
      shortcut: 'Ctrl+Shift+F',
      type: 'toggle' as const,
      checked: activePanels.includes('filters'),
      onClick: () => onTogglePanel('filters'),
    },
    { id: 'sep1', label: '', type: 'separator' },
    ...Object.entries(LAYOUT_PRESETS).map(([name, panels]) => ({
      id: `layout-${name}`,
      label: `Layout: ${name}`,
      type: 'action' as const,
      onClick: () => onSetLayout(panels),
    })),
    { id: 'sep2', label: '', type: 'separator' },
    {
      id: 'newWorkspace',
      label: 'New Workspace',
      shortcut: 'Ctrl+Shift+N',
      type: 'action' as const,
      onClick: () => onNewWorkspace?.(),
    },
    {
      id: 'reset',
      label: 'Reset Layout',
      type: 'action' as const,
      onClick: () => onSetLayout(['chart', 'candidates', 'positions', 'log']),
    },
  ]

  const intelItems: MenuItem[] = INTEL_PANELS.map((p) => ({
    id: p.id,
    label: p.label,
    type: 'toggle' as const,
    checked: activePanels.includes(p.id),
    badge: intelCounts[p.badgeKey],
    onClick: () => onTogglePanel(p.id),
  }))

  const toolsItems: MenuItem[] = [
    {
      id: 'config',
      label: 'Config Panel',
      shortcut: 'Ctrl+,',
      type: 'action' as const,
      onClick: onToggleSidebar,
    },
    {
      id: 'analytics',
      label: 'Analytics',
      shortcut: 'Ctrl+A',
      type: 'toggle' as const,
      checked: activePanels.includes('analytics'),
      onClick: () => onTogglePanel('analytics'),
    },
    { id: 'sep1', label: '', type: 'separator' },
    {
      id: 'health',
      label: 'Connection Health',
      type: 'toggle' as const,
      checked: activePanels.includes('health'),
      onClick: () => onTogglePanel('health'),
    },
    { id: 'sep2', label: '', type: 'separator' },
    {
      id: 'wallet',
      label: 'Wallet',
      type: 'action' as const,
      onClick: () => onCommand?.('wallet'),
    },
    {
      id: 'connection',
      label: 'Connection / Mode',
      type: 'action' as const,
      onClick: () => onCommand?.('connection'),
    },
    {
      id: 'cmdK',
      label: 'Command Palette',
      shortcut: 'Ctrl+K',
      type: 'action' as const,
      onClick: () => onCommand?.('palette'),
    },
    {
      id: 'shortcuts',
      label: 'Keyboard Shortcuts',
      type: 'action' as const,
      onClick: () => onCommand?.('shortcuts'),
    },
    {
      id: 'export',
      label: 'Export Trade Journal',
      type: 'action' as const,
      onClick: () => onCommand?.('export'),
    },
  ]

  const menus = [
    { label: 'View', key: 'view', items: viewItems },
    { label: 'Intelligence', key: 'intel', items: intelItems },
    { label: 'Tools', key: 'tools', items: toolsItems },
  ]

  return (
    <div className="menu-bar">
      <div className="menu-bar__logo">
        <Activity size={14} strokeWidth={3} />
      </div>
      <div className="menu-bar__title">BIGAL TERMINAL</div>
      <div className="menu-bar__sep" />

      {menus.map((m) => {
        const leaveTimer = { current: 0 as unknown as ReturnType<typeof setTimeout> }
        return (
          <div
            key={m.key}
            style={{ position: 'relative' }}
            onMouseEnter={() => {
              clearTimeout(leaveTimer.current)
            }}
            onMouseLeave={() => {
              if (openMenu === m.key) {
                leaveTimer.current = setTimeout(close, 250)
              }
            }}
          >
            <button
              className="menu-trigger"
              aria-haspopup="menu"
              aria-expanded={openMenu === m.key}
              data-open={openMenu === m.key}
              onClick={() => toggle(m.key)}
            >
              {m.label}
              <ChevronDown
                size={12}
                strokeWidth={2.5}
                style={{ opacity: 0.5, marginLeft: '2px' }}
              />
            </button>
            {openMenu === m.key && <DropdownMenu items={m.items} onClose={close} />}
          </div>
        )
      })}

      <div className="menu-bar__right">
        {isPreview ? (
          <span className="preview-feed-label">SYNTHETIC DATA</span>
        ) : (
          <LatencyPipeline latency={latency} />
        )}
        <div className="menu-bar__sep" />

        <div className={`status-chip ${isConnected && !isPreview ? 'status-chip--live' : ''}`}>
          <span className={`status-dot ${isConnected ? 'status-dot--on' : 'status-dot--off'}`} />
          {isPreview ? 'LOCAL PREVIEW' : isConnected ? 'CONNECTED' : 'OFFLINE'}
        </div>

        <button
          className={`status-chip ${isLive ? 'status-chip--live' : 'status-chip--paper'}`}
          onClick={onToggleMode}
          title="Connection and mode"
        >
          {isPreview ? 'PREVIEW' : isLive ? 'LIVE' : 'PAPER'}
        </button>

        {isPaused && (
          <button
            className="status-chip status-chip--paused"
            onClick={onTogglePause}
            title="Resume trading"
          >
            PAUSED
          </button>
        )}

        <button
          className="menu-balance"
          onClick={() => onCommand?.('wallet')}
          title="Open wallet"
          style={{ font: '600 11px var(--font-mono)', color: 'var(--text-bright)' }}
        >
          {balance.toFixed(4)}
          <span style={{ fontSize: '9px', color: 'var(--text-tertiary)', marginLeft: '4px' }}>
            SOL
          </span>
        </button>

        <Clock />

        {onTerminate && (
          <button
            onClick={() => {
              if (isPreview || window.confirm('Terminate bot? Open positions will be closed.'))
                onTerminate()
            }}
            style={{
              marginLeft: 8,
              padding: '2px 8px',
              background: 'rgba(255, 50, 50, 0.12)',
              border: '1px solid rgba(255, 50, 50, 0.3)',
              borderRadius: 3,
              color: '#ff4444',
              fontSize: 9,
              fontWeight: 700,
              fontFamily: 'var(--font-ui)',
              cursor: 'pointer',
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}
          >
            {isPreview ? 'End Preview' : 'Terminate'}
          </button>
        )}
      </div>
    </div>
  )
}
