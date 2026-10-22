import { useCallback, useRef } from 'react'
import { Target, TrendingDown, ShieldAlert, Gem, Sliders } from 'lucide-react'
import { useConfigStore, markPending } from '../../stores/configStore'
import { Slider } from '../shared/Slider'
import {
  type ConfigDict,
  EXIT_SLIDERS,
  ENTRY_SLIDERS,
  RISK_SLIDERS,
  MOONBAG_SLIDERS,
  type SliderDef,
} from '../../types/config'
import type { WSOutgoing } from '../../types/ws'

const DEBOUNCE_MS = 80

interface Props {
  send: (msg: WSOutgoing) => void
}

const FILTER_GROUPS = [
  { id: 'entry', label: 'Entry Filters', icon: Target, sliders: ENTRY_SLIDERS },
  { id: 'exit', label: 'Exit Rules', icon: TrendingDown, sliders: EXIT_SLIDERS },
  { id: 'risk', label: 'Risk Limits', icon: ShieldAlert, sliders: RISK_SLIDERS },
  { id: 'moonbag', label: 'Moonbag', icon: Gem, sliders: MOONBAG_SLIDERS },
] as const

export function FiltersPanel({ send }: Props) {
  const config = useConfigStore((s) => s.config)
  const updateKey = useConfigStore((s) => s.updateKey)
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const handleSlider = useCallback(
    (key: keyof ConfigDict, value: number) => {
      const k = String(key)
      updateKey(k, value)
      markPending(k, value)
      clearTimeout(debounceRef.current[String(key)])
      debounceRef.current[String(key)] = setTimeout(() => {
        send({ type: 'config_update', data: { [key]: value } })
      }, DEBOUNCE_MS)
    },
    [updateKey, send],
  )

  return (
    <div className="filters-panel">
      <div className="filters-panel__header">
        <Sliders size={12} />
        <span>Quick Filters</span>
        <span className="filters-panel__hint">Adjust without opening Settings</span>
      </div>
      <div className="filters-panel__body">
        {FILTER_GROUPS.map((group) => (
          <div key={group.id} className="filters-group">
            <div className="filters-group__header">
              <group.icon size={11} />
              <span>{group.label}</span>
            </div>
            <div className="filters-group__sliders">
              {group.sliders.map((s: SliderDef) => (
                <div key={s.key} className="filters-slider-row">
                  <div className="filters-slider-row__label">
                    <span>{s.label}</span>
                    <span className="filters-slider-row__value">
                      {((config[s.key] as number) ?? s.min).toFixed(s.step < 1 ? 2 : 0)}
                    </span>
                  </div>
                  <Slider
                    label={s.label}
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    suffix={s.suffix}
                    value={(config[s.key] as number) ?? s.min}
                    onChange={(v) => handleSlider(s.key, v)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
