import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  LineChart,
  Users,
  Briefcase,
  Terminal,
  History,
  Shield,
  TrendingUp,
  Heart,
  Sliders,
} from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useHotkeys } from '../../hooks/useHotkeys'
import { PanelErrorBoundary } from '../shared/PanelErrorBoundary'
import { ToastContainer } from '../shared/Toast'
import { StartupModal } from '../modal/StartupModal'
import { SettingsModal } from '../modal/SettingsModal'
import { CommandPalette } from '../shared/CommandPalette'
import { ChartPanel } from '../panels/ChartPanel'
import { PositionsGrid } from '../panels/PositionsGrid'
import { CandidatesGrid } from '../panels/CandidatesGrid'
import { TradeHistory } from '../panels/TradeHistory'
import { LogTerminal } from '../panels/LogTerminal'
import { TickerTiles } from '../panels/TickerTiles'
import { HealthPanel } from '../panels/HealthPanel'
import { AnalyticsPanel } from '../panels/AnalyticsPanel'
import { AdvancedChartPanel } from '../panels/AdvancedChartPanel'
import { FiltersPanel } from '../panels/FiltersPanel'
import { HoneypotLogPanel } from '../panels/HoneypotLogPanel'
import { GraduationPanel } from '../panels/GraduationPanel'
import { WalletPanel } from '../panels/WalletPanel'
import MenuBar from './MenuBar'
import { StatsBar } from './StatsBar'
import Workspace, { type PanelDefinition } from './Workspace'
import { TERMINAL_VERSION } from '../../lib/version'
import { pnlLabels } from '../../lib/chartData'

const ICON_SIZE = 14
const DEFAULT_PANELS = ['chart', 'candidates', 'positions', 'log']

export function TerminalShell() {
  const { send } = useWebSocket()
  const modeSelected = useTerminalStore((s) => s.modeSelected)
  const paused = useTerminalStore((s) => s.paused)
  const connected = useTerminalStore((s) => s.connected)
  const mode = useTerminalStore((s) => s.mode)
  const balance = useTerminalStore((s) => s.balance)
  const latency = useTerminalStore((s) => s.latency)
  const isNewWorkspace = new URLSearchParams(window.location.search).get('workspace') === 'new'
  const [activePanels, setActivePanels] = useState<string[]>(isNewWorkspace ? [] : DEFAULT_PANELS)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [connectionOpen, setConnectionOpen] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const panelRegistry = useMemo(() => {
    const reg = new Map<string, PanelDefinition>()
    const add = (id: string, label: string, icon: ReactNode, component: ReactNode) => {
      reg.set(id, {
        id,
        label,
        icon,
        component: <PanelErrorBoundary name={label}>{component}</PanelErrorBoundary>,
      })
    }
    add('chart', 'Chart', <LineChart size={ICON_SIZE} />, <ChartPanel />)
    add('candidates', 'Candidates', <Users size={ICON_SIZE} />, <CandidatesGrid />)
    add('positions', 'Positions', <Briefcase size={ICON_SIZE} />, <PositionsGrid send={send} />)
    add('log', 'Terminal Log', <Terminal size={ICON_SIZE} />, <LogTerminal />)
    add('tradeHistory', 'Trade History', <History size={ICON_SIZE} />, <TradeHistory />)
    add('honeypotLog', 'Honeypot Log', <Shield size={ICON_SIZE} />, <HoneypotLogPanel />)
    add('graduation', 'Near Graduation', <TrendingUp size={ICON_SIZE} />, <GraduationPanel />)
    add('health', 'Connection Health', <Heart size={ICON_SIZE} />, <HealthPanel />)
    add('analytics', 'Analytics', <TrendingUp size={ICON_SIZE} />, <AnalyticsPanel />)
    add('advancedChart', 'Advanced Chart', <LineChart size={ICON_SIZE} />, <AdvancedChartPanel />)
    add('filters', 'Quick Filters', <Sliders size={ICON_SIZE} />, <FiltersPanel send={send} />)
    return reg
  }, [send])

  const handleTogglePanel = useCallback(
    (id: string) => {
      if (!panelRegistry.has(id) && id !== 'tickerBar') return
      setActivePanels((previous) =>
        previous.includes(id) ? previous.filter((panel) => panel !== id) : [...previous, id],
      )
    },
    [panelRegistry],
  )
  const handleSetLayout = useCallback(
    (panels: string[]) => {
      setActivePanels(panels.filter((id) => panelRegistry.has(id) || id === 'tickerBar'))
    },
    [panelRegistry],
  )
  const handlePauseToggle = useCallback(
    () => send({ type: 'pause_trading', paused: !paused }),
    [send, paused],
  )
  const handleNewWorkspace = useCallback(() => {
    window.open(
      `${window.location.origin}${window.location.pathname}?workspace=new`,
      '_blank',
      'noopener',
    )
  }, [])
  const handleExport = useCallback(() => {
    const rows = useTerminalStore.getState().trades
    const fields = [
      'time',
      'symbol',
      'name',
      'action',
      'pnl_pct',
      'pnl_sol',
      'cum_pnl',
      'ts',
      'simulated',
      'execution_confirmed',
      'projected_pnl_sol',
    ] as const
    const cell = (value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) return '""'
      let text = String(value ?? '')
      if (typeof value === 'string' && /^[=+@-]/.test(text)) text = `'${text}`
      return `"${text.replaceAll('"', '""')}"`
    }
    const csv = [
      [...fields, 'session_mode', 'pnl_basis'].join(','),
      ...rows.map((row) =>
        [...fields.map((key) => cell(row[key])), cell(mode), cell(pnlLabels(mode).title)].join(','),
      ),
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = mode.toUpperCase().includes('PREVIEW')
      ? 'preview-trade-journal.csv'
      : 'trade-journal.csv'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [mode])
  const handleCommand = useCallback(
    (action: string) => {
      switch (action) {
        case 'palette':
          setPaletteOpen(true)
          break
        case 'settings':
          setSettingsOpen(true)
          break
        case 'connection':
          setConnectionOpen(true)
          break
        case 'wallet':
          setWalletOpen(true)
          break
        case 'shortcuts':
          setShortcutsOpen(true)
          break
        case 'export':
          handleExport()
          break
        case 'newWorkspace':
          handleNewWorkspace()
          break
        default:
          handleTogglePanel(action)
      }
    },
    [handleExport, handleNewWorkspace, handleTogglePanel],
  )
  const hotkeys = useMemo(
    () => ({
      ' ': handlePauseToggle,
      escape: () => {
        setSettingsOpen(false)
        setPaletteOpen(false)
        setWalletOpen(false)
        setShortcutsOpen(false)
        setConnectionOpen(false)
      },
      'mod+k': () => setPaletteOpen((open) => !open),
      'mod+,': () => setSettingsOpen((open) => !open),
      'mod+shift+c': () => handleCommand('advancedChart'),
      'mod+shift+f': () => handleCommand('filters'),
      'mod+shift+n': handleNewWorkspace,
      'mod+1': () => handleTogglePanel('chart'),
      'mod+2': () => handleTogglePanel('candidates'),
      'mod+3': () => handleTogglePanel('positions'),
      'mod+4': () => handleTogglePanel('log'),
      'mod+5': () => handleTogglePanel('tradeHistory'),
      'mod+6': () => handleTogglePanel('tickerBar'),
      'mod+a': () => handleTogglePanel('analytics'),
    }),
    [handlePauseToggle, handleCommand, handleNewWorkspace, handleTogglePanel],
  )
  useHotkeys(hotkeys)

  const isPreview = mode.toUpperCase().includes('PREVIEW')
  const isLive = mode.toUpperCase().includes('LIVE')
  const showTicker = activePanels.includes('tickerBar')
  if (!modeSelected) return <StartupModal send={send} />

  return (
    <div
      className="terminal-shell"
      style={{
        display: 'grid',
        gridTemplateRows: showTicker ? '34px 28px minmax(0,1fr) 28px' : '34px 28px minmax(0,1fr)',
        height: '100dvh',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}
    >
      <MenuBar
        activePanels={activePanels}
        onTogglePanel={handleTogglePanel}
        onSetLayout={handleSetLayout}
        onToggleSidebar={() => setSettingsOpen((open) => !open)}
        isLive={isLive}
        isPreview={isPreview}
        isPaused={paused}
        isConnected={connected}
        onTogglePause={handlePauseToggle}
        onToggleMode={() => setConnectionOpen(true)}
        onTerminate={() => send({ type: 'terminate_bot' })}
        onNewWorkspace={handleNewWorkspace}
        onCommand={handleCommand}
        latency={latency}
        balance={balance}
      />
      <StatsBar />
      <div style={{ overflow: 'hidden', minHeight: 0 }}>
        <Workspace
          activePanels={activePanels}
          onTogglePanel={handleTogglePanel}
          panelRegistry={panelRegistry}
          onCommand={handleCommand}
        />
      </div>
      {showTicker && <TickerTiles />}
      <ToastContainer />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} send={send} />
      {paletteOpen && <CommandPalette open onClose={() => setPaletteOpen(false)} send={send} />}
      <WalletPanel open={walletOpen} onClose={() => setWalletOpen(false)} />
      {connectionOpen && <StartupModal send={send} onClose={() => setConnectionOpen(false)} />}
      {shortcutsOpen && (
        <div className="settings-overlay" onClick={() => setShortcutsOpen(false)}>
          <div
            className="terminal-shortcuts"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Keyboard shortcuts</h2>
            <p>Space — pause or resume</p>
            <p>Ctrl/⌘ + 1–6 — panels and ticker</p>
            <p>Ctrl/⌘ + K — command palette</p>
            <p>Ctrl/⌘ + , — configuration</p>
            <p>Ctrl/⌘ + Shift + C — advanced chart</p>
            <p>Ctrl/⌘ + Shift + F — quick filters</p>
            <p>Ctrl/⌘ + Shift + N — new workspace</p>
            <p>Escape — close overlays</p>
            <button
              className="login-btn login-btn--secondary"
              onClick={() => setShortcutsOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
      <span
        style={{
          position: 'fixed',
          bottom: 1,
          right: 6,
          fontSize: 7,
          color: 'var(--muted)',
          fontFamily: 'var(--font-data)',
          opacity: 0.4,
          pointerEvents: 'none',
        }}
      >
        v{TERMINAL_VERSION}
      </span>
    </div>
  )
}
