import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  name?: string
}

interface State {
  hasError: boolean
  error: string
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: '' })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 8,
            color: 'var(--dim)',
            fontSize: 'var(--text-sm)',
            padding: 16,
            textAlign: 'center',
          }}
        >
          <span style={{ color: 'var(--red)' }}>{this.props.name ?? 'Panel'} crashed</span>
          <span
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--muted)',
              maxWidth: 200,
              wordBreak: 'break-word',
            }}
          >
            {this.state.error}
          </span>
          <button
            onClick={this.handleReset}
            style={{
              marginTop: 4,
              padding: '4px 12px',
              background: 'var(--card2)',
              border: '1px solid var(--bdr)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--accent)',
              cursor: 'pointer',
            }}
          >
            Reload panel
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
