import { useState, useCallback, useRef, useEffect, memo } from 'react'
import type { ReactNode } from 'react'
import { X, Activity, Maximize2, Minimize2 } from 'lucide-react'

export interface PanelDefinition {
  id: string
  label: string
  icon: ReactNode
  component?: ReactNode
  minWidth?: number
}

interface WorkspaceProps {
  activePanels: string[]
  onTogglePanel: (id: string) => void
  panelRegistry: Map<string, PanelDefinition>
  onCommand?: (action: string) => void
}

const PanelContainer = memo(function PanelContainer({
  panel,
  isMaximized,
  onClose,
  onMaximize,
}: {
  panel: PanelDefinition
  isMaximized: boolean
  onClose: () => void
  onMaximize: () => void
}) {
  return (
    <div
      className="panel"
      aria-label={panel.label}
      style={isMaximized ? { position: 'absolute', inset: 0, zIndex: 10 } : undefined}
    >
      <div className="panel__header" onDoubleClick={onMaximize}>
        <div style={{ display: 'flex', alignItems: 'center', opacity: 0.6 }}>{panel.icon}</div>
        <span className="panel__header-title">{panel.label}</span>
        <button
          className="panel__header-close"
          onClick={onMaximize}
          aria-label={`${isMaximized ? 'Restore' : 'Maximize'} ${panel.label}`}
          title={isMaximized ? 'Restore panel' : 'Maximize panel'}
        >
          {isMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
        </button>
        <button
          className="panel__header-close"
          onClick={onClose}
          aria-label={`Close ${panel.label}`}
          title="Close panel"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
      <div className="panel__body">{panel.component}</div>
    </div>
  )
})

/** Cursor-style command shortcuts for the empty state */
const EMPTY_COMMANDS: { label: string; shortcut: string; action: string }[] = [
  { label: 'Advanced Chart', shortcut: 'Ctrl + Shift + C', action: 'advancedChart' },
  { label: 'Quick Filters', shortcut: 'Ctrl + Shift + F', action: 'filters' },
  { label: 'Command Palette', shortcut: 'Ctrl + K', action: 'palette' },
  { label: 'Open Settings', shortcut: 'Ctrl + ,', action: 'settings' },
  { label: 'New Workspace', shortcut: 'Ctrl + Shift + N', action: 'newWorkspace' },
]

function EmptyLauncher({
  registry,
  onAdd,
  onCommand,
}: {
  registry: Map<string, PanelDefinition>
  onAdd: (id: string) => void
  onCommand?: (action: string) => void
}) {
  return (
    <div className="workspace-empty">
      {/* Large faded BigAl logo — Cursor style */}
      <div className="workspace-empty__logo">
        <Activity size={64} strokeWidth={1.2} />
      </div>

      {/* Command list — Cursor style shortcuts */}
      <div className="workspace-empty__commands">
        {EMPTY_COMMANDS.filter(
          (cmd) =>
            registry.has(cmd.action) ||
            ['palette', 'settings', 'newWorkspace'].includes(cmd.action),
        ).map((cmd) => (
          <button
            key={cmd.action}
            className="workspace-empty__cmd"
            onClick={() => {
              if (
                cmd.action === 'palette' ||
                cmd.action === 'settings' ||
                cmd.action === 'newWorkspace'
              ) {
                onCommand?.(cmd.action)
              } else {
                onAdd(cmd.action)
              }
            }}
          >
            <span className="workspace-empty__cmd-label">{cmd.label}</span>
            <span className="workspace-empty__cmd-shortcut">
              {cmd.shortcut.split(' + ').map((k, i) => (
                <span key={i}>
                  {i > 0 && <span className="workspace-empty__cmd-plus">+</span>}
                  <kbd className="workspace-empty__cmd-key">{k}</kbd>
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function AddModuleTile({
  registry,
  activePanels,
  onAdd,
  onCommand,
}: {
  registry: Map<string, PanelDefinition>
  activePanels: string[]
  onAdd: (id: string) => void
  onCommand?: (action: string) => void
}) {
  const [open, setOpen] = useState(false)
  const available = Array.from(registry.values()).filter((p) => !activePanels.includes(p.id))
  if (available.length === 0) return null

  return (
    <div className="panel workspace-add-tile">
      {!open ? (
        <div className="workspace-add-tile__closed">
          {/* Faded logo like Cursor */}
          <button
            className="workspace-add-button"
            aria-label="Add panel"
            onClick={() => setOpen(true)}
          >
            <Activity size={28} strokeWidth={1} style={{ color: 'var(--muted)', opacity: 0.5 }} />
            <span>Add panel</span>
          </button>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
              marginTop: 8,
            }}
          >
            {EMPTY_COMMANDS.filter(
              (cmd) =>
                !registry.has(cmd.action) || available.some((panel) => panel.id === cmd.action),
            )
              .slice(0, 4)
              .map((cmd) => (
                <button
                  key={cmd.action}
                  className="workspace-empty__cmd workspace-empty__cmd--compact"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (
                      cmd.action === 'palette' ||
                      cmd.action === 'settings' ||
                      cmd.action === 'newWorkspace'
                    ) {
                      onCommand?.(cmd.action)
                    } else {
                      onAdd(cmd.action)
                    }
                  }}
                >
                  <span className="workspace-empty__cmd-label">{cmd.label}</span>
                  <span className="workspace-empty__cmd-shortcut">
                    {cmd.shortcut.split(' + ').map((k, i) => (
                      <span key={i}>
                        {i > 0 && <span className="workspace-empty__cmd-plus">+</span>}
                        <kbd className="workspace-empty__cmd-key">{k}</kbd>
                      </span>
                    ))}
                  </span>
                </button>
              ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '4px',
            padding: '8px',
            width: '100%',
            overflow: 'auto',
          }}
        >
          {available.map((p) => (
            <button
              key={p.id}
              className="workspace-empty__tile"
              style={{ padding: '10px 6px', gap: '4px' }}
              onClick={(e) => {
                e.stopPropagation()
                onAdd(p.id)
                setOpen(false)
              }}
            >
              <div style={{ opacity: 0.7 }}>{p.icon}</div>
              <span style={{ fontSize: '9px', textAlign: 'center' }}>{p.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Resize handle between two vertically stacked areas */
function DragHandle({ onDrag }: { onDrag: (deltaY: number) => void }) {
  const startY = useRef<number | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (startY.current === null) return
      onDrag(e.clientY - startY.current)
      startY.current = e.clientY
    }
    const onUp = () => {
      startY.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [onDrag])

  return (
    <div
      className="workspace-divider"
      role="separator"
      aria-label="Resize panels"
      aria-orientation="horizontal"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          onDrag(event.key === 'ArrowDown' ? 16 : -16)
        }
      }}
      onMouseDown={(e) => {
        startY.current = e.clientY
        document.body.style.cursor = 'row-resize'
        document.body.style.userSelect = 'none'
      }}
    />
  )
}

/** A column that stacks N panels vertically with resize handles between each */
function StackColumn({
  panels,
  registry,
  activePanels,
  onTogglePanel,
  onMaximize,
  showAdd,
  onCommand,
}: {
  panels: PanelDefinition[]
  registry: Map<string, PanelDefinition>
  activePanels: string[]
  onTogglePanel: (id: string) => void
  onMaximize: (id: string) => void
  showAdd: boolean
  onCommand?: (action: string) => void
}) {
  const totalSlots = panels.length + (showAdd ? 1 : 0)
  const colRef = useRef<HTMLDivElement>(null)

  // Track height fractions for each slot (equal by default)
  const [fractions, setFractions] = useState<number[]>(() => Array(totalSlots).fill(1 / totalSlots))

  const handleDrag = useCallback(
    (index: number, deltaY: number) => {
      if (!colRef.current) return
      const totalH = colRef.current.clientHeight
      const deltaPct = deltaY / totalH
      setFractions((prev) => {
        const next =
          prev.length === totalSlots ? [...prev] : Array<number>(totalSlots).fill(1 / totalSlots)
        const minFrac = 60 / totalH // 60px minimum
        const pairTotal = next[index] + next[index + 1]
        const floor = Math.min(minFrac, pairTotal / 2)
        next[index] = Math.max(floor, Math.min(pairTotal - floor, next[index] + deltaPct))
        next[index + 1] = pairTotal - next[index]
        return next
      })
    },
    [totalSlots],
  )

  if (panels.length === 1 && !showAdd) {
    return (
      <div
        className="workspace-column"
        ref={colRef}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      >
        <PanelContainer
          panel={panels[0]}
          isMaximized={false}
          onClose={() => onTogglePanel(panels[0].id)}
          onMaximize={() => onMaximize(panels[0].id)}
        />
      </div>
    )
  }

  const items: Array<{ type: 'panel'; panel: PanelDefinition } | { type: 'add' }> = [
    ...panels.map((p) => ({ type: 'panel' as const, panel: p })),
    ...(showAdd ? [{ type: 'add' as const }] : []),
  ]

  return (
    <div
      className="workspace-column"
      ref={colRef}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
    >
      {items.map((item, i) => (
        <div key={item.type === 'panel' ? item.panel.id : 'add'} style={{ display: 'contents' }}>
          {i > 0 && <DragHandle onDrag={(dy) => handleDrag(i - 1, dy)} />}
          <div
            className="workspace-slot"
            style={{
              flex: `${fractions.length === totalSlots ? fractions[i] : 1 / totalSlots} 0 0%`,
              overflow: 'hidden',
              minHeight: 60,
            }}
          >
            {item.type === 'panel' ? (
              <PanelContainer
                panel={item.panel}
                isMaximized={false}
                onClose={() => onTogglePanel(item.panel.id)}
                onMaximize={() => onMaximize(item.panel.id)}
              />
            ) : (
              <AddModuleTile
                registry={registry}
                activePanels={activePanels}
                onAdd={onTogglePanel}
                onCommand={onCommand}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Workspace({
  activePanels,
  onTogglePanel,
  panelRegistry,
  onCommand,
}: WorkspaceProps) {
  const [maximized, setMaximized] = useState<string | null>(null)

  const handleMaximize = useCallback((id: string) => {
    setMaximized((prev) => (prev === id ? null : id))
  }, [])

  if (activePanels.length === 0) {
    return (
      <div className="workspace" style={{ display: 'flex' }}>
        <EmptyLauncher registry={panelRegistry} onAdd={onTogglePanel} onCommand={onCommand} />
      </div>
    )
  }

  if (maximized && activePanels.includes(maximized)) {
    const panel = panelRegistry.get(maximized)
    if (panel) {
      return (
        <div className="workspace" style={{ display: 'flex', position: 'relative' }}>
          <PanelContainer
            panel={panel}
            isMaximized={true}
            onClose={() => {
              setMaximized(null)
              onTogglePanel(maximized)
            }}
            onMaximize={() => setMaximized(null)}
          />
        </div>
      )
    }
  }

  const allPanels = activePanels
    .map((id) => panelRegistry.get(id))
    .filter((p): p is PanelDefinition => !!p)

  // Distribute into 2 columns max. Round-robin: odd indices left, even indices right.
  // With 4 panels: L=[0,2] R=[1,3] → Chart+Positions left, Candidates+Log right
  if (allPanels.length <= 2) {
    // 1-2 panels: single row, no stacking
    return (
      <div
        className="workspace workspace-grid"
        style={{
          display: 'grid',
          gridTemplateColumns:
            allPanels.length === 1 ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,1fr)',
          gap: '1px',
          background: 'var(--bdr-panel)',
        }}
      >
        {allPanels.map((p) => (
          <PanelContainer
            key={p.id}
            panel={p}
            isMaximized={false}
            onClose={() => onTogglePanel(p.id)}
            onMaximize={() => handleMaximize(p.id)}
          />
        ))}
      </div>
    )
  }

  // 3+ panels: 2 columns with vertical stacking
  const left: PanelDefinition[] = []
  const right: PanelDefinition[] = []
  allPanels.forEach((p, i) => {
    if (i % 2 === 0) left.push(p)
    else right.push(p)
  })

  return (
    <div
      className="workspace workspace-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
        gap: '1px',
        background: 'var(--bdr-panel)',
      }}
    >
      <StackColumn
        key={`left-${left.map((panel) => panel.id).join('-')}`}
        panels={left}
        registry={panelRegistry}
        activePanels={activePanels}
        onTogglePanel={onTogglePanel}
        onMaximize={handleMaximize}
        showAdd={left.length < right.length}
        onCommand={onCommand}
      />
      <StackColumn
        key={`right-${right.map((panel) => panel.id).join('-')}`}
        panels={right}
        registry={panelRegistry}
        activePanels={activePanels}
        onTogglePanel={onTogglePanel}
        onMaximize={handleMaximize}
        showAdd={right.length < left.length}
        onCommand={onCommand}
      />
    </div>
  )
}
