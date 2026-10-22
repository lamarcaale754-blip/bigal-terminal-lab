import { Fragment, memo, useCallback, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import { Activity, Maximize2, Minimize2, Plus, X } from 'lucide-react'
import '../styles/workspace.css'

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
  const titleId = useId()
  return (
    <section className="panel" aria-labelledby={titleId} data-panel-id={panel.id}>
      <div className="panel__header" onDoubleClick={onMaximize}>
        <span className="panel__icon" aria-hidden="true">
          {panel.icon}
        </span>
        <h2 className="panel__header-title" id={titleId}>
          {panel.label}
        </h2>
        <button
          type="button"
          className="panel__header-action"
          aria-label={`${isMaximized ? 'Restore' : 'Maximize'} ${panel.label}`}
          aria-pressed={isMaximized}
          title={isMaximized ? 'Restore panel' : 'Maximize panel'}
          data-focus-action="maximize"
          onClick={onMaximize}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button
          type="button"
          className="panel__header-action"
          aria-label={`Close ${panel.label}`}
          title="Close panel"
          onClick={onClose}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <X size={14} />
        </button>
      </div>
      <div className="panel__body">{panel.component}</div>
    </section>
  )
})

function PanelChoices({
  panels,
  onAdd,
}: {
  panels: PanelDefinition[]
  onAdd: (id: string) => void
}) {
  return (
    <div className="workspace-panel-choices">
      {panels.map((panel) => (
        <button
          key={panel.id}
          type="button"
          className="workspace-panel-choice"
          onClick={() => onAdd(panel.id)}
          aria-label={`Add ${panel.label} panel`}
        >
          <span aria-hidden="true">{panel.icon}</span>
          <span>{panel.label}</span>
          <Plus size={13} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

function EmptyLauncher({
  registry,
  onAdd,
}: {
  registry: Map<string, PanelDefinition>
  onAdd: (id: string) => void
}) {
  return (
    <div className="workspace-empty">
      <Activity size={44} strokeWidth={1.2} aria-hidden="true" />
      <h2>Your workspace</h2>
      <p>Add a panel to inspect the current session.</p>
      <PanelChoices panels={[...registry.values()]} onAdd={onAdd} />
    </div>
  )
}

/** Pointer capture keeps resizing local to the handle, including touch input. */
function DragHandle({
  label,
  percent,
  onResize,
  onReset,
}: {
  label: string
  percent: number
  onResize: (deltaPixels: number) => void
  onReset: () => void
}) {
  const previousY = useRef<number | null>(null)
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 40 : 12
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      onResize(event.key === 'ArrowDown' ? step : -step)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      onResize(event.key === 'Home' ? -10000 : 10000)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onReset()
    }
  }
  return (
    <div
      className="workspace-divider"
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={`${Math.round(percent)} percent for the upper panel`}
      title="Drag or use Up/Down to resize. Enter resets equal heights."
      onKeyDown={handleKeyDown}
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        previousY.current = event.clientY
      }}
      onPointerMove={(event) => {
        if (previousY.current === null) return
        onResize(event.clientY - previousY.current)
        previousY.current = event.clientY
      }}
      onPointerUp={(event) => {
        previousY.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onPointerCancel={() => {
        previousY.current = null
      }}
      onLostPointerCapture={() => {
        previousY.current = null
      }}
    >
      <span aria-hidden="true" />
    </div>
  )
}

function StackColumn({
  panels,
  available,
  activePanels,
  onTogglePanel,
  onMaximize,
  showAdd,
}: {
  panels: PanelDefinition[]
  available: PanelDefinition[]
  activePanels: string[]
  onTogglePanel: (id: string) => void
  onMaximize: (id: string) => void
  showAdd: boolean
}) {
  const count = panels.length + (showAdd ? 1 : 0)
  const columnRef = useRef<HTMLDivElement>(null)
  // The parent keys columns by their members, so a changed layout starts evenly.
  const [fractions, setFractions] = useState(() => Array<number>(count).fill(1 / count))
  const resize = useCallback((index: number, deltaPixels: number) => {
    const height = columnRef.current?.clientHeight ?? 0
    if (height <= 0) return
    setFractions((previous) => {
      const next = [...previous]
      const sum = next[index] + next[index + 1]
      const minimum = Math.min(96 / height, sum / 2)
      next[index] = Math.min(sum - minimum, Math.max(minimum, next[index] + deltaPixels / height))
      next[index + 1] = sum - next[index]
      return next
    })
  }, [])
  const reset = (index: number) =>
    setFractions((previous) => {
      const next = [...previous]
      const half = (next[index] + next[index + 1]) / 2
      next[index] = half
      next[index + 1] = half
      return next
    })
  return (
    <div className="workspace-column" ref={columnRef}>
      {Array.from({ length: count }, (_, index) => {
        const panel = panels[index]
        const previous = panels[index - 1]
        const percent =
          index > 0 ? (100 * fractions[index - 1]) / (fractions[index - 1] + fractions[index]) : 0
        return (
          <Fragment key={panel?.id ?? 'add'}>
            {index > 0 && (
              <DragHandle
                label={`Resize ${previous?.label ?? 'upper panel'} and ${panel?.label ?? 'panel picker'}`}
                percent={percent}
                onResize={(delta) => resize(index - 1, delta)}
                onReset={() => reset(index - 1)}
              />
            )}
            <div
              className={`workspace-slot${panel ? '' : ' workspace-slot--picker'}`}
              style={
                {
                  flexGrow: fractions[index],
                  '--workspace-order': panel ? activePanels.indexOf(panel.id) : activePanels.length,
                } as CSSProperties
              }
            >
              {panel ? (
                <PanelContainer
                  panel={panel}
                  isMaximized={false}
                  onClose={() => onTogglePanel(panel.id)}
                  onMaximize={() => onMaximize(panel.id)}
                />
              ) : (
                <div className="workspace-add-panel">
                  <h2>Add a panel</h2>
                  <PanelChoices panels={available} onAdd={onTogglePanel} />
                </div>
              )}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

export default function Workspace({ activePanels, onTogglePanel, panelRegistry }: WorkspaceProps) {
  const [maximized, setMaximized] = useState<string | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const panels = [...new Set(activePanels)]
    .map((id) => panelRegistry.get(id))
    .filter((panel): panel is PanelDefinition => Boolean(panel))
  const available = [...panelRegistry.values()].filter((panel) => !activePanels.includes(panel.id))

  const focusPanel = (id?: string) =>
    requestAnimationFrame(() => {
      const root = workspaceRef.current
      if (!root) return
      const target = [...root.querySelectorAll<HTMLElement>('[data-panel-id]')].find(
        (element) => element.dataset.panelId === id,
      )
      const button =
        target?.querySelector<HTMLButtonElement>('button') ??
        root.querySelector<HTMLButtonElement>('button')
      button?.focus()
    })
  const toggleMaximized = (id: string) => {
    setMaximized((previous) => (previous === id ? null : id))
    focusPanel(id)
  }
  const closePanel = (id: string) => {
    if (maximized === id) setMaximized(null)
    onTogglePanel(id)
    focusPanel()
  }
  const addPanel = (id: string) => {
    onTogglePanel(id)
    focusPanel(id)
  }
  const maximizedPanel = panels.find((panel) => panel.id === maximized)
  const left = panels.filter((_, index) => index % 2 === 0)
  const right = panels.filter((_, index) => index % 2 === 1)
  const showPicker = panels.length > 2 && panels.length % 2 === 1 && available.length > 0

  return (
    <div
      ref={workspaceRef}
      className={`workspace${panels.length === 1 ? ' workspace--single' : ''}${maximizedPanel ? ' workspace--maximized' : ''}`}
      aria-label="Analysis workspace"
    >
      {panels.length === 0 ? (
        <EmptyLauncher registry={panelRegistry} onAdd={addPanel} />
      ) : maximizedPanel ? (
        <PanelContainer
          panel={maximizedPanel}
          isMaximized
          onClose={() => closePanel(maximizedPanel.id)}
          onMaximize={() => toggleMaximized(maximizedPanel.id)}
        />
      ) : (
        <>
          <StackColumn
            key={`left:${left.map((panel) => panel.id).join(',')}`}
            panels={left}
            available={available}
            activePanels={activePanels}
            showAdd={false}
            onTogglePanel={(id) => (activePanels.includes(id) ? closePanel(id) : addPanel(id))}
            onMaximize={toggleMaximized}
          />
          {right.length > 0 && (
            <StackColumn
              key={`right:${right.map((panel) => panel.id).join(',')}:${showPicker}`}
              panels={right}
              available={available}
              activePanels={activePanels}
              showAdd={showPicker}
              onTogglePanel={(id) => (activePanels.includes(id) ? closePanel(id) : addPanel(id))}
              onMaximize={toggleMaximized}
            />
          )}
        </>
      )}
    </div>
  )
}
