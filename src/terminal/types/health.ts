/** Connection health endpoint status */
export interface EndpointHealth {
  name: string
  healthy: boolean
  latency_ms: number
  last_error: string
  detail: string
  last_check: number
}

/** Health status color derived from state */
export type HealthColor = 'green' | 'yellow' | 'red' | 'unknown'

export function getHealthColor(ep: EndpointHealth): HealthColor {
  if (!ep.healthy) return 'red'
  if (ep.latency_ms > 200) return 'red'
  if (ep.latency_ms > 50) return 'yellow'
  return 'green'
}

/** Clock skew status */
export interface ClockSkew {
  drift_ms: number
  warning: boolean
}
