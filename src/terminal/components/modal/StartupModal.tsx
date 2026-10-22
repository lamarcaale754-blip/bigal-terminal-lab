import { useEffect, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  ChevronRight,
  Plug,
  Radio,
  Server,
  Shield,
  X,
  Zap,
} from 'lucide-react'
import { useTerminalStore } from '../../stores/terminalStore'
import type { WSOutgoing } from '../../types/ws'

type BackendMode = 'paper' | 'legacy' | 'zmq_rust'
const MODES: { id: BackendMode; label: string; desc: string; color: string; live: boolean }[] = [
  {
    id: 'paper',
    label: 'Paper',
    desc: 'Local bot with simulated execution',
    color: 'var(--cyan)',
    live: false,
  },
  {
    id: 'zmq_rust',
    label: 'Live Rust',
    desc: 'Connected Rust executor',
    color: 'var(--green)',
    live: true,
  },
  {
    id: 'legacy',
    label: 'Live Legacy',
    desc: 'Connected HTTP executor',
    color: 'var(--orange)',
    live: true,
  },
]

export function StartupModal({
  send,
  onClose,
}: {
  send: (msg: WSOutgoing) => void
  onClose?: () => void
}) {
  const connected = useTerminalStore((s) => s.connected)
  const currentMode = useTerminalStore((s) => s.mode)
  const snapshotMode = useTerminalStore((s) => s.snapshotMode)
  const startupHints = useTerminalStore((s) => s.startupHints)
  const modeError = useTerminalStore((s) => s.modeError)
  const wsUrl = useTerminalStore((s) => s.wsUrl)
  const [endpoint, setEndpoint] = useState(wsUrl || 'ws://127.0.0.1:8765')
  const [selectedMode, setSelectedMode] = useState<BackendMode | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const isPreview = currentMode.toUpperCase().includes('PREVIEW')
  const backendConnected = connected && !isPreview
  const availableModes = startupHints.available_modes ?? []
  const modeInfo = MODES.find((mode) => mode.id === selectedMode)
  const available =
    selectedMode !== null && backendConnected && availableModes.includes(selectedMode)

  useEffect(() => {
    if (!submitted || !onClose || !selectedMode) return
    const accepted =
      selectedMode === 'paper'
        ? currentMode.toUpperCase() === 'PAPER'
        : selectedMode === 'legacy'
          ? currentMode.toUpperCase().includes('LEGACY')
          : currentMode.toUpperCase().includes('RUST')
    if (accepted && !modeError) onClose()
  }, [currentMode, modeError, onClose, selectedMode, submitted])

  function resumeSession() {
    const state = useTerminalStore.getState()
    state.setModeAck({
      mode: snapshotMode,
      balance: state.balance,
      executor_type: state.executorType,
    })
    onClose?.()
  }

  return (
    <div className="login-overlay">
      <div
        className="login-card"
        role="dialog"
        aria-modal="true"
        aria-label="Connect BigAl Terminal"
        style={{ width: 740, maxHeight: '90dvh' }}
      >
        <div className="login-brand">
          <div className="login-brand__logo">
            <Activity size={20} strokeWidth={3} />
          </div>
          <div className="login-brand__title">BIGAL</div>
          <div className="login-brand__subtitle">TERMINAL</div>
          <div style={{ flex: 1 }} />
          <div className="login-brand__version">v2.0</div>
        </div>
        <div className="login-form">
          <div className="login-steps">
            <span className="login-step login-step--active">Mode</span>
            <ChevronRight size={12} />
            <span className={`login-step ${selectedMode ? 'login-step--active' : ''}`}>
              Connection
            </span>
            {onClose && (
              <button
                style={{ marginLeft: 'auto' }}
                aria-label="Close connection setup"
                onClick={onClose}
              >
                <X size={15} />
              </button>
            )}
          </div>
          {!selectedMode ? (
            <div className="login-mode-select">
              <h2 className="login-heading">Select mode</h2>
              <p className="login-description">
                Connect your local bot or inspect the terminal in Preview.
              </p>
              <div className="login-mode-grid">
                <button
                  className="login-mode-card"
                  onClick={() => {
                    send({ type: 'demo_start' })
                    onClose?.()
                  }}
                >
                  <span
                    className="login-mode-card__accent"
                    style={{ background: 'var(--purple)' }}
                  />
                  <span className="login-mode-card__body">
                    <span className="login-mode-card__name" style={{ color: 'var(--purple)' }}>
                      Preview
                    </span>
                    <span className="login-mode-card__desc">
                      Synthetic positions and market data. No connection or orders.
                    </span>
                  </span>
                </button>
                {MODES.map((mode) => {
                  const disabled =
                    mode.live && (!backendConnected || !availableModes.includes(mode.id))
                  return (
                    <button
                      key={mode.id}
                      className="login-mode-card"
                      disabled={disabled}
                      title={
                        disabled ? 'Connect a backend that advertises this executor' : mode.desc
                      }
                      onClick={() => {
                        setSelectedMode(mode.id)
                        setSubmitted(false)
                      }}
                    >
                      <span
                        className="login-mode-card__accent"
                        style={{ background: mode.color }}
                      />
                      <span className="login-mode-card__body">
                        <span className="login-mode-card__name" style={{ color: mode.color }}>
                          {mode.label}
                        </span>
                        <span className="login-mode-card__desc">{mode.desc}</span>
                        {disabled && <span className="login-field__hint">Backend required</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="login-config">
              <div className="login-section">
                <div className="login-section-header">
                  <Zap size={12} />
                  <span>{modeInfo?.label}</span>
                </div>
                <p className="login-description">
                  {modeInfo?.live
                    ? 'Real execution uses the wallet and endpoint configured on your connected backend.'
                    : 'Paper runs the local bot with simulated fills. Preview is available without a running backend.'}
                </p>
              </div>
            </div>
          )}

          <div className="login-config">
            <div className="login-section">
              <div className="login-section-header">
                <Plug size={12} />
                <span>Terminal connection</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    color: backendConnected ? 'var(--green)' : 'var(--dim)',
                    fontSize: 9,
                  }}
                >
                  {backendConnected ? 'CONNECTED' : 'DISCONNECTED'}
                </span>
              </div>
              <label className="login-field__label" htmlFor="terminal-endpoint">
                Backend WebSocket endpoint
              </label>
              <div className="login-connect-row">
                <input
                  id="terminal-endpoint"
                  className="login-field__input"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                  placeholder="ws://127.0.0.1:8765"
                  spellCheck={false}
                />
                <button
                  className="login-btn login-btn--secondary"
                  disabled={!endpoint.trim()}
                  onClick={() => send({ type: 'connect', url: endpoint.trim() })}
                >
                  Connect
                </button>
                {backendConnected && (
                  <button
                    className="login-btn login-btn--ghost"
                    onClick={() => send({ type: 'disconnect' })}
                  >
                    Disconnect
                  </button>
                )}
              </div>
              <p className="login-field__hint">
                Connection starts only when you choose Connect. Use the locally served UI for a
                local ws:// backend; a secure page requires wss://.
              </p>
            </div>
            {backendConnected && (
              <div className="login-section">
                <div className="login-section-header">
                  <Server size={12} />
                  <span>Backend status</span>
                </div>
                <p className="login-field__hint">
                  Available modes:{' '}
                  {availableModes.length ? availableModes.join(', ') : 'waiting for capabilities'}
                </p>
                <p className="login-field__hint">
                  <Shield size={11} /> Credentials stay on the backend. This form does not collect
                  private keys.
                </p>
                <p className="login-field__hint">
                  <Radio size={11} /> No gRPC subscription is required for the local paper session.
                </p>
              </div>
            )}
            {modeError && (
              <div className="login-error" role="alert">
                {modeError}
              </div>
            )}
            <div className="login-actions">
              {selectedMode && (
                <button
                  className="login-btn login-btn--secondary"
                  onClick={() => {
                    setSelectedMode(null)
                    setSubmitted(false)
                  }}
                >
                  <ArrowLeft size={12} /> Back
                </button>
              )}
              <div style={{ flex: 1 }} />
              {backendConnected &&
                snapshotMode &&
                !snapshotMode.toUpperCase().includes('PREVIEW') && (
                  <button className="login-btn login-btn--secondary" onClick={resumeSession}>
                    Open running session
                  </button>
                )}
              {selectedMode && (
                <button
                  className="login-btn login-btn--primary"
                  disabled={!available}
                  onClick={() => {
                    setSubmitted(true)
                    send({ type: 'mode_select', mode: selectedMode })
                  }}
                >
                  Launch {modeInfo?.label}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
