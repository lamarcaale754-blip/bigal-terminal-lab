import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ChartCandlestick,
  ChevronRight,
  Download,
  FileJson,
  FlaskConical,
  Info,
  ListFilter,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  SkipForward,
  Upload,
} from 'lucide-react'
import { makeDemoTicks } from './core/demo'
import { aggregateCandles } from './core/candles'
import type { ParseResult } from './core/types'
import { useReplay } from './hooks/useReplay'
import Workspace, { type PanelDefinition } from './components/Workspace'
import { PanelErrorBoundary } from './components/PanelErrorBoundary'
import { MarketChart } from './components/MarketChart'
import {
  ActivityLog,
  DataQuality,
  SessionDetails,
  TradeTape,
  Watchlist,
  type ActivityEntry,
} from './components/DataPanels'
import { download, number, price, summarize, utc } from './lib'

interface Session extends ParseResult {
  id: number
  name: string
  synthetic: boolean
}
const demoTicks = makeDemoTicks()
const DEFAULT_PANELS = ['chart', 'watchlist', 'details', 'tape']
const PANEL_IDS = ['chart', 'watchlist', 'details', 'tape', 'quality', 'log']

function savedPanels(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('bigal.workspace.v1') ?? 'null')
    if (Array.isArray(saved))
      return Array.from(
        new Set(
          saved.filter((id): id is string => typeof id === 'string' && PANEL_IDS.includes(id)),
        ),
      )
  } catch {
    /* A blocked/full storage area never prevents startup. */
  }
  return DEFAULT_PANELS
}

export default function App() {
  const [session, setSession] = useState<Session>({
    id: 1,
    name: 'Deterministic market session',
    synthetic: true,
    ticks: demoTicks,
    issues: [],
    duplicateCount: 0,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const workerRef = useRef<Worker | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => () => workerRef.current?.terminate(), [])
  async function importFile(file: File) {
    setError('')
    if (file.size > 5 * 1024 * 1024) {
      setError('File exceeds the 5 MiB import limit. The current session was kept.')
      return
    }
    setBusy(true)
    try {
      const text = await file.text()
      const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current?.terminate()
      workerRef.current = worker
      worker.onmessage = (
        event: MessageEvent<{ ok: boolean; result?: ParseResult; error?: string }>,
      ) => {
        worker.terminate()
        workerRef.current = null
        setBusy(false)
        const result = event.data.result
        if (!event.data.ok || !result?.ticks.length) {
          setError(
            event.data.error ??
              result?.issues[0]?.message ??
              'No valid observations found. The current session was kept.',
          )
          return
        }
        setSession((previous) => ({
          ...result,
          id: previous.id + 1,
          name: file.name,
          synthetic: false,
        }))
      }
      worker.onerror = () => {
        worker.terminate()
        workerRef.current = null
        setBusy(false)
        setError('Unable to parse this session. The current session was kept.')
      }
      worker.postMessage(text)
    } catch {
      setBusy(false)
      setError('Unable to read this file. The current session was kept.')
    }
  }
  return (
    <>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".jsonl,.ndjson,.json,.txt"
        aria-label="Import observations file"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.target.value = ''
        }}
      />
      <Terminal
        key={session.id}
        session={session}
        busy={busy}
        error={error}
        dismissError={() => setError('')}
        openFile={() => inputRef.current?.click()}
        resetDemo={() => {
          setError('')
          setSession((previous) => ({
            id: previous.id + 1,
            name: 'Deterministic market session',
            synthetic: true,
            ticks: demoTicks,
            issues: [],
            duplicateCount: 0,
          }))
        }}
      />
    </>
  )
}

function Terminal({
  session,
  busy,
  error,
  dismissError,
  openFile,
  resetDemo,
}: {
  session: Session
  busy: boolean
  error: string
  dismissError: () => void
  openFile: () => void
  resetDemo: () => void
}) {
  const replay = useReplay(session.ticks, session.synthetic)
  const [symbol, setSymbol] = useState(session.ticks[0]?.symbol ?? 'ALPHA')
  const [intervalMs, setIntervalMs] = useState(30_000)
  const [panels, setPanels] = useState(savedPanels)
  const [help, setHelp] = useState(false)
  const helpRef = useRef<HTMLDialogElement>(null)
  const [entries, setEntries] = useState<ActivityEntry[]>([
    {
      id: 1,
      time: utc(session.ticks[0].ts),
      level: 'info',
      text: `${session.synthetic ? 'Synthetic demonstration' : 'Local file'} loaded: ${number(session.ticks.length)} accepted observations.`,
    },
    {
      id: 2,
      time: utc(session.ticks[0].ts),
      level: session.issues.length ? 'warning' : 'info',
      text: `${session.issues.length} validation issues; ${session.duplicateCount} duplicate IDs removed. No network feed connected.`,
    },
  ])
  const summaries = useMemo(() => summarize(replay.visible), [replay.visible])
  const selected = summaries.find((s) => s.symbol === symbol)
  const progress =
    replay.end > replay.start
      ? ((replay.time - replay.start) / (replay.end - replay.start)) * 100
      : 100
  function addLog(text: string) {
    setEntries((previous) => [
      ...previous.slice(-199),
      { id: (previous.at(-1)?.id ?? 0) + 1, time: utc(replay.time), level: 'info', text },
    ])
  }
  function togglePanel(id: string) {
    if (PANEL_IDS.includes(id))
      setPanels((previous) =>
        previous.includes(id) ? previous.filter((p) => p !== id) : [...previous, id],
      )
  }
  useEffect(() => {
    try {
      localStorage.setItem('bigal.workspace.v1', JSON.stringify(panels))
    } catch {
      /* Optional preference storage. */
    }
  }, [panels])
  useEffect(() => {
    if (help) helpRef.current?.showModal()
    else helpRef.current?.close()
  }, [help])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.matches('input,textarea,select,button') || event.target.isContentEditable)
      )
        return
      if (event.code === 'Space' && !help) {
        event.preventDefault()
        replay.toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [replay, help])
  const registry = new Map<string, PanelDefinition>(
    [
      [
        'chart',
        {
          id: 'chart',
          label: 'Price chart',
          icon: <ChartCandlestick size={14} />,
          component: (
            <MarketChart
              ticks={replay.visible}
              symbol={symbol}
              intervalMs={intervalMs}
              onIntervalChange={setIntervalMs}
            />
          ),
        },
      ],
      [
        'watchlist',
        {
          id: 'watchlist',
          label: 'Instrument watchlist',
          icon: <ListFilter size={14} />,
          component: <Watchlist ticks={replay.visible} symbol={symbol} select={setSymbol} />,
        },
      ],
      [
        'details',
        {
          id: 'details',
          label: 'Session statistics',
          icon: <Activity size={14} />,
          component: <SessionDetails ticks={replay.visible} symbol={symbol} />,
        },
      ],
      [
        'tape',
        {
          id: 'tape',
          label: 'Trade tape',
          icon: <Radio size={14} />,
          component: <TradeTape ticks={replay.visible} symbol={symbol} />,
        },
      ],
      [
        'quality',
        {
          id: 'quality',
          label: 'Data quality',
          icon: <ShieldCheck size={14} />,
          component: (
            <DataQuality
              ticks={replay.visible}
              total={session.ticks.length}
              issues={session.issues}
              duplicates={session.duplicateCount}
            />
          ),
        },
      ],
      [
        'log',
        {
          id: 'log',
          label: 'Event log',
          icon: <FileJson size={14} />,
          component: <ActivityLog entries={entries} />,
        },
      ],
    ].map(([id, definition]) => [id, definition]) as [string, PanelDefinition][],
  )
  for (const [id, panel] of registry)
    registry.set(id, {
      ...panel,
      component: <PanelErrorBoundary name={panel.label}>{panel.component}</PanelErrorBoundary>,
    })
  function exportCandles() {
    const rows = aggregateCandles(replay.visible, symbol, intervalMs)
    download(
      `${symbol}-${intervalMs / 1000}s-candles.csv`,
      [
        'time_utc,open_usd,high_usd,low_usd,close_usd,volume_base,vwap_usd,samples',
        ...rows.map((c) =>
          [
            new Date(c.time * 1000).toISOString(),
            c.open,
            c.high,
            c.low,
            c.close,
            c.volume ?? '',
            c.vwap ?? '',
            c.samples,
          ].join(','),
        ),
      ].join('\n'),
      'text/csv',
    )
    addLog(`Exported ${rows.length} visible ${symbol} candles at ${intervalMs / 1000}s resolution.`)
  }
  return (
    <div className="terminal-shell">
      <header className="app-header">
        <div className="brand">
          <Activity size={25} strokeWidth={2} />
          <div>
            <strong>
              BigAl<span> / </span>Terminal Lab
            </strong>
            <small>MARKET DATA · ENGINEERING WORKSPACE</small>
          </div>
        </div>
        <div className="header-actions">
          <span className="offline-indicator">
            <span /> Local engine
          </span>
          <button onClick={() => setHelp(true)}>
            <Info size={15} /> Data contract
          </button>
          <a
            href="https://github.com/lamarcaale754-blip/bigal-terminal-lab"
            target="_blank"
            rel="noreferrer"
          >
            Source <ChevronRight size={13} />
          </a>
        </div>
      </header>
      <div className="source-bar">
        <div className={`source-badge ${session.synthetic ? 'synthetic' : ''}`}>
          <FlaskConical size={13} />
          {session.synthetic ? 'SYNTHETIC DEMO' : 'LOCAL FILE REPLAY'}
        </div>
        <span className="session-name" title={session.name}>
          {session.name}
        </span>
        <span className="source-explanation">
          {session.synthetic
            ? 'Fictional instruments · reproducible observations'
            : 'Browser-local processing · no upload'}
        </span>
        <span className="source-spacer" />
        <button disabled={busy} onClick={resetDemo}>
          <RotateCcw size={13} /> Load demo
        </button>
        <button disabled={busy} className="button-accent" onClick={openFile}>
          <Upload size={13} />
          {busy ? 'Validating…' : 'Import JSONL'}
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button aria-label="Dismiss import error" onClick={dismissError}>
            ×
          </button>
        </div>
      )}
      <div className="stats-strip">
        <div>
          <span>SELECTED INSTRUMENT</span>
          <strong>
            {symbol}
            <small> / USD</small>
          </strong>
        </div>
        <div>
          <span>LAST OBSERVED PRICE</span>
          <strong>{selected ? `$${price(selected.last.price)}` : '—'}</strong>
        </div>
        <div>
          <span>CHANGE IN VISIBLE SESSION</span>
          <strong className={selected && selected.change >= 0 ? 'positive' : 'negative'}>
            {selected ? `${selected.change >= 0 ? '+' : ''}${selected.change.toFixed(2)}%` : '—'}
          </strong>
        </div>
        <div>
          <span>OBSERVATIONS REPLAYED</span>
          <strong data-testid="record-count">
            {number(replay.visible.length)}
            <small> / {number(session.ticks.length)}</small>
          </strong>
        </div>
        <div>
          <span>DATA QUALITY</span>
          <strong className={session.issues.length ? 'warning' : 'positive'}>
            {session.issues.length ? `${session.issues.length} issues` : 'Validated'}
            <small>
              {session.duplicateCount ? ` · ${session.duplicateCount} duplicates` : ' · event time'}
            </small>
          </strong>
        </div>
      </div>
      <nav className="panel-nav" aria-label="Workspace panels">
        <span>WORKSPACE</span>
        {Array.from(registry.values()).map((p) => (
          <button key={p.id} aria-pressed={panels.includes(p.id)} onClick={() => togglePanel(p.id)}>
            {p.icon}
            {p.label}
          </button>
        ))}
        <button
          className="reset-layout"
          onClick={() => setPanels(DEFAULT_PANELS)}
          title="Restore default panel arrangement"
        >
          Reset layout
        </button>
      </nav>
      <main className="workspace-region">
        <Workspace activePanels={panels} onTogglePanel={togglePanel} panelRegistry={registry} />
      </main>
      <footer className="replay-footer">
        <div className="replay-controls">
          <button
            className="play-button"
            onClick={() => {
              replay.toggle()
              addLog(replay.playing ? 'Replay paused.' : 'Replay started.')
            }}
            aria-label={replay.playing ? 'Pause replay' : 'Play replay'}
          >
            {replay.playing ? <Pause size={16} /> : <Play size={16} />}{' '}
            {replay.playing ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={() => replay.seek(replay.start)}
            aria-label="Restart replay"
            title="Restart"
          >
            <RotateCcw size={15} />
          </button>
          <button
            onClick={replay.step}
            aria-label="Next observation"
            title="Step to next event time"
          >
            <SkipForward size={15} />
          </button>
          <select
            aria-label="Replay speed"
            value={replay.speed}
            onChange={(e) => replay.setSpeed(Number(e.target.value))}
          >
            {[1, 5, 20, 100].map((s) => (
              <option key={s} value={s}>
                {s}× speed
              </option>
            ))}
          </select>
          <span className="replay-clock">
            {utc(replay.time)} <small>UTC</small>
          </span>
          <span className="replay-state">
            {replay.time >= replay.end ? 'END OF SESSION' : replay.playing ? 'REPLAYING' : 'PAUSED'}
          </span>
          <span className="source-spacer" />
          <button onClick={exportCandles}>
            <Download size={13} /> Export candles
          </button>
          <button
            onClick={() => {
              download(
                'observations.jsonl',
                session.ticks.map((t) => JSON.stringify(t)).join('\n') + '\n',
                'application/x-ndjson',
              )
              addLog('Exported normalized full-session observations.')
            }}
          >
            <Download size={13} /> Export session
          </button>
        </div>
        <div className="timeline">
          <time>{utc(replay.start)}</time>
          <input
            aria-label="Replay position"
            type="range"
            min={replay.start}
            max={Math.max(replay.start + 1, replay.end)}
            step="1"
            value={replay.time}
            onChange={(e) => replay.seek(Number(e.target.value))}
            style={{ '--progress': `${progress}%` } as React.CSSProperties}
          />
          <time>{utc(replay.end)}</time>
          <span>{progress.toFixed(1)}%</span>
        </div>
        <div className="footer-note">
          <span>
            {new Date(replay.start).toISOString().slice(0, 10)} · UTC timestamps · all prices
            normalized to USD
          </span>
          <span>No credentials · no subscription · no order execution</span>
        </div>
      </footer>
      <dialog
        ref={helpRef}
        className="help-dialog"
        onCancel={() => setHelp(false)}
        onClose={() => setHelp(false)}
      >
        <div className="dialog-title">
          <h2>Bring your own observations</h2>
          <button onClick={() => setHelp(false)} aria-label="Close data contract">
            ×
          </button>
        </div>
        <p>
          One JSON object per line. Imports run in a browser worker and never leave your device.
          Maximum 5 MiB or 20,000 nonblank records.
        </p>
        <pre>
          {
            '{"id":"obs-1","ts":1776693600000,"symbol":"ALPHA",\n "price":120.5,"size":2.4,"side":"buy"}'
          }
        </pre>
        <dl>
          <dt>id</dt>
          <dd>
            Unique event ID. Identical duplicates are removed; conflicting duplicates are reported.
          </dd>
          <dt>ts</dt>
          <dd>
            UTC epoch milliseconds, from 1970-01-01 through 2100-01-01. Input is sorted by
            timestamp, with stable order for ties.
          </dd>
          <dt>symbol / price</dt>
          <dd>
            Instrument identifier and finite USD price between 1e-12 and 1e12, inclusive. Convert
            quote currency before import.
          </dd>
          <dt>size / side</dt>
          <dd>
            Optional base-asset quantity (1e-12 through 1e12) and buy/sell aggressor. Omit values
            that were not recorded.
          </dd>
        </dl>
        <p>
          Candles use observed prices only. Empty periods remain gaps. Volume and session VWAP are
          hidden if the selected stream lacks sizes. These are sampled observations, not guaranteed
          full-market OHLC.
        </p>
        <a
          className="sample-link"
          href={`${import.meta.env.BASE_URL}example-session.jsonl`}
          download
        >
          Download a small example session <Download size={14} />
        </a>
        <p className="muted">
          Space toggles replay. Panel headers support maximize; resize handles support keyboard
          adjustment. This demo does not test or connect to a paid market-data provider.
        </p>
        <button className="button-accent" onClick={() => setHelp(false)}>
          Back to workspace
        </button>
      </dialog>
    </div>
  )
}
