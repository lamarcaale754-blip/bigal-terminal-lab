import { useState, useCallback, useRef, memo } from 'react'
import {
  Settings,
  X,
  TrendingDown,
  Target,
  ShieldAlert,
  Gem,
  Cpu,
  Shield,
  Compass,
  BookMarked,
} from 'lucide-react'
import { useConfigStore, markPending } from '../../stores/configStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { Slider } from '../shared/Slider'
import { Toggle } from '../shared/Toggle'
import {
  EXIT_SLIDERS,
  ENTRY_SLIDERS,
  RISK_SLIDERS,
  MOONBAG_SLIDERS,
  type SliderDef,
} from '../../types/config'
import type { WSOutgoing } from '../../types/ws'

const DEBOUNCE_MS = 80

const TABS = [
  { id: 'exit', label: 'Exit Rules', icon: TrendingDown },
  { id: 'entry', label: 'Entry Filters', icon: Target },
  { id: 'risk', label: 'Risk Limits', icon: ShieldAlert },
  { id: 'moonbag', label: 'Moonbag', icon: Gem },
  { id: 'hft', label: 'HFT Features', icon: Cpu },
  { id: 'safety', label: 'Safety', icon: Shield },
  { id: 'strategy', label: 'Strategy', icon: Compass },
  { id: 'presets', label: 'Presets', icon: BookMarked },
] as const

interface Props {
  open: boolean
  onClose: () => void
  send: (msg: WSOutgoing) => void
}

export const SettingsModal = memo(function SettingsModal({ open, onClose, send }: Props) {
  const [activeTab, setActiveTab] = useState<string>('exit')
  const config = useConfigStore((s) => s.config)
  const updateKey = useConfigStore((s) => s.updateKey)
  const presets = useTerminalStore((s) => s.presets)
  const customPresets = useTerminalStore((s) => s.customPresets)
  const [presetName, setPresetName] = useState('')
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const handleSlider = useCallback(
    (key: string, value: number | string) => {
      updateKey(key, value)
      markPending(key, value)
      clearTimeout(debounceRef.current[key])
      debounceRef.current[key] = setTimeout(() => {
        send({ type: 'config_update', data: { [key]: value } })
      }, DEBOUNCE_MS)
    },
    [updateKey, send],
  )

  const handleToggle = useCallback(
    (key: string, checked: boolean) => {
      updateKey(key, checked)
      markPending(key, checked)
      send({ type: 'config_update', data: { [key]: checked } })
    },
    [updateKey, send],
  )

  const handleNumToggle = useCallback(
    (key: string, val: boolean) => {
      const num = val ? 1 : 0
      updateKey(key, num)
      markPending(key, num)
      send({ type: 'config_update', data: { [key]: num } })
    },
    [updateKey, send],
  )

  if (!open) return null

  const currentTab = TABS.find((t) => t.id === activeTab) || TABS[0]

  return (
    <div
      className="settings-overlay"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div
        className="settings-window"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left sidebar navigation */}
        <div className="settings-sidebar">
          <div className="settings-sidebar__header">
            <Settings size={14} strokeWidth={2} />
            <span>Settings</span>
          </div>
          <div className="settings-sidebar__nav">
            {TABS.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  className={`settings-nav-item ${activeTab === tab.id ? 'settings-nav-item--active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon size={13} strokeWidth={activeTab === tab.id ? 2.5 : 1.5} />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Right content area */}
        <div className="settings-content">
          {/* Content header */}
          <div className="settings-content__header">
            <span className="settings-content__title">{currentTab.label}</span>
            <button className="settings-close" aria-label="Close Settings" onClick={onClose}>
              <X size={14} strokeWidth={2} />
            </button>
          </div>

          {/* Content body */}
          <div className="settings-content__body">
            {activeTab === 'exit' && (
              <SliderSection sliders={EXIT_SLIDERS} config={config} onChange={handleSlider} />
            )}
            {activeTab === 'entry' && (
              <SliderSection sliders={ENTRY_SLIDERS} config={config} onChange={handleSlider} />
            )}
            {activeTab === 'risk' && (
              <SliderSection sliders={RISK_SLIDERS} config={config} onChange={handleSlider} />
            )}
            {activeTab === 'moonbag' && (
              <SliderSection sliders={MOONBAG_SLIDERS} config={config} onChange={handleSlider} />
            )}
            {activeTab === 'hft' && (
              <div className="settings-toggles">
                <ToggleRow
                  label="Dynamic Hold"
                  desc="Adjust hold time based on momentum"
                  checked={!!config.dynamic_hold_enabled}
                  onChange={(v) => handleToggle('dynamic_hold_enabled', v)}
                />
                <ToggleRow
                  label="Volume Exit"
                  desc="Exit on abnormal volume spikes"
                  checked={!!config.volume_exit_enabled}
                  onChange={(v) => handleToggle('volume_exit_enabled', v)}
                />
              </div>
            )}
            {activeTab === 'safety' && (
              <div className="settings-toggles">
                <ToggleRow
                  label="Velocity Check"
                  desc="Monitor rapid price drops"
                  checked={!!config.velocity_check}
                  onChange={(v) => handleNumToggle('velocity_check', v)}
                />
                {!!config.velocity_check && (
                  <div style={{ paddingLeft: 24 }}>
                    <Slider
                      label="Velocity Drop"
                      value={Number(config.velocity_drop) || 0}
                      min={0}
                      max={50}
                      step={1}
                      suffix="%"
                      onChange={(v) => handleSlider('velocity_drop', v)}
                    />
                  </div>
                )}
                <ToggleRow
                  label="Anti-Manipulation"
                  desc="Detect wash trading and fake volume"
                  checked={!!config.anti_manip}
                  onChange={(v) => handleNumToggle('anti_manip', v)}
                />
                <ToggleRow
                  label="Dev Dump Panic"
                  desc="Emergency exit if dev wallet dumps"
                  checked={!!config.dev_dump_panic_enabled}
                  onChange={(v) => handleToggle('dev_dump_panic_enabled', v)}
                />
              </div>
            )}
            {activeTab === 'strategy' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="settings-section">
                  <div className="settings-section__label">Execution Mode</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['manual', 'adaptive', 'hybrid'].map((m) => (
                      <button
                        key={m}
                        onClick={() => handleSlider('strategy_mode', m)}
                        className={`settings-mode-btn ${config.strategy_mode === m ? 'settings-mode-btn--active' : ''}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section__label">Jito Tips</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                    <Slider
                      label="Manual Tip"
                      value={Number(config.manual_tip) || 0}
                      min={0}
                      max={0.1}
                      step={0.001}
                      suffix=" SOL"
                      onChange={(v) => handleSlider('manual_tip', v)}
                    />
                    <Slider
                      label="Max Tip"
                      value={Number(config.max_tip_sol) || 0.01}
                      min={0}
                      max={0.1}
                      step={0.001}
                      suffix=" SOL"
                      onChange={(v) => handleSlider('max_tip_sol', v)}
                    />
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'presets' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="settings-section">
                  <div className="settings-section__label">Load Preset</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.keys(presets).map((name) => (
                      <button
                        key={name}
                        className="settings-preset-btn"
                        onClick={() => send({ type: 'preset', name })}
                      >
                        {name}
                      </button>
                    ))}
                    {customPresets.map((name) => (
                      <button
                        key={`c-${name}`}
                        className="settings-preset-btn settings-preset-btn--custom"
                        onClick={() => send({ type: 'preset', name })}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section__label">Save Current Configuration</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      placeholder="Preset name..."
                      className="settings-input"
                    />
                    <button
                      onClick={() => {
                        if (presetName.trim()) {
                          send({ type: 'save_preset', name: presetName.trim(), data: config })
                          setPresetName('')
                        }
                      }}
                      disabled={!presetName.trim()}
                      className="settings-save-btn"
                      style={{ opacity: presetName.trim() ? 1 : 0.4 }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="settings-toggle-row">
      <div>
        <div className="settings-toggle-row__label">{label}</div>
        <div className="settings-toggle-row__desc">{desc}</div>
      </div>
      <Toggle label="" checked={checked} onChange={onChange} />
    </div>
  )
}

function SliderSection({
  sliders,
  config,
  onChange,
}: {
  sliders: SliderDef[]
  config: Record<string, unknown>
  onChange: (key: string, value: number) => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
      {sliders.map((s) => (
        <Slider
          key={s.key}
          label={s.label}
          value={Number(config[s.key]) || s.min}
          min={s.min}
          max={s.max}
          step={s.step}
          suffix={s.suffix}
          onChange={(v) => onChange(String(s.key), v)}
        />
      ))}
    </div>
  )
}
