import { useEffect } from 'react'

type HotkeyMap = Record<string, () => void>

/**
 * Global keyboard shortcut hook.
 * Disabled when focus is on input/textarea/select elements.
 */
export function useHotkeys(hotkeys: HotkeyMap) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // Build key string
      const parts: string[] = []
      if (e.metaKey || e.ctrlKey) parts.push('mod')
      if (e.shiftKey) parts.push('shift')
      if (e.altKey) parts.push('alt')
      parts.push(e.key.toLowerCase())
      const combo = parts.join('+')

      const action = hotkeys[combo] || hotkeys[e.key.toLowerCase()]
      if (action) {
        e.preventDefault()
        action()
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [hotkeys])
}
