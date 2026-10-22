import { useEffect } from 'react'
import { useTerminalStore, type ToastItem } from '../../stores/terminalStore'

const LEVEL_COLORS: Record<string, string> = {
  info: 'var(--cyan)',
  success: 'var(--green)',
  warning: 'var(--orange)',
  error: 'var(--red)',
}

function ToastEntry({ toast }: { toast: ToastItem }) {
  const removeToast = useTerminalStore((s) => s.removeToast)

  useEffect(() => {
    const timer = setTimeout(() => removeToast(toast.id), toast.ttl_ms)
    return () => clearTimeout(timer)
  }, [toast.id, toast.ttl_ms, removeToast])

  const color = LEVEL_COLORS[toast.level] || 'var(--dim)'

  return (
    <div
      onClick={() => removeToast(toast.id)}
      style={{
        padding: '8px 12px',
        background: 'var(--card)',
        border: `1px solid ${color}40`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-sm)',
        color: 'var(--txt)',
        cursor: 'pointer',
        animation: 'slideIn 0.2s ease-out',
        maxWidth: 320,
        wordBreak: 'break-word',
      }}
    >
      {toast.message}
    </div>
  )
}

export function ToastContainer() {
  const toasts = useTerminalStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        zIndex: 9999,
        pointerEvents: 'auto',
      }}
    >
      {toasts.map((t) => (
        <ToastEntry key={t.id} toast={t} />
      ))}
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
