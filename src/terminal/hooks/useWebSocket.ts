import { useEffect, useRef, useCallback } from 'react'
import type { WSOutgoing } from '../types/ws'
import { useTerminalStore } from '../stores/terminalStore'
import { dispatchFrame } from '../lib/protocol'
import { startPreview } from '../lib/preview'

/** A page never connects to a wallet/backend until the user explicitly chooses Connect. */
export function useWebSocket() {
  const socket = useRef<WebSocket | null>(null)
  const preview = useRef<ReturnType<typeof startPreview> | null>(null)
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const connectionEpoch = useRef(0)

  const disconnect = useCallback(() => {
    connectionEpoch.current++
    clearTimeout(retry.current)
    preview.current?.stop()
    preview.current = null
    const previous = socket.current
    socket.current = null
    previous?.close()
    useTerminalStore.getState().setConnected(false)
  }, [])

  const connect = useCallback(
    (input: string) => {
      disconnect()
      let url: URL
      try {
        url = new URL(/^wss?:\/\//.test(input) ? input : `ws://${input}`)
        if (
          !['ws:', 'wss:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error('Use a WebSocket URL without credentials or query parameters.')
        if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
          throw new Error('The standalone terminal connects only to a local backend.')
        if (window.location.protocol === 'https:')
          throw new Error(
            'Open the locally served dashboard at http://127.0.0.1:8766 to connect. The public site is a UI preview.',
          )
      } catch (error) {
        useTerminalStore
          .getState()
          .setModeError(error instanceof Error ? error.message : 'Invalid connection URL')
        return
      }
      useTerminalStore.getState().resetSession()
      useTerminalStore.getState().setWsUrl(url.href)
      const epoch = connectionEpoch.current
      const attempt = (count: number) => {
        if (connectionEpoch.current !== epoch) return
        const ws = new WebSocket(url.href)
        socket.current = ws
        ws.onopen = () => {
          if (connectionEpoch.current !== epoch) return
          useTerminalStore.getState().setConnected(true)
          useTerminalStore.getState().setModeError('')
        }
        ws.onmessage = (event) => {
          if (
            socket.current !== ws ||
            typeof event.data !== 'string' ||
            event.data.length > 8_000_000
          )
            return
          try {
            dispatchFrame(JSON.parse(event.data))
          } catch {
            useTerminalStore
              .getState()
              .addToast({ message: 'Malformed backend frame ignored', level: 'warning' })
          }
        }
        ws.onclose = () => {
          if (socket.current !== ws || connectionEpoch.current !== epoch) return
          socket.current = null
          useTerminalStore.getState().setConnected(false)
          if (count < 4)
            retry.current = setTimeout(() => attempt(count + 1), Math.min(8000, 1000 * 2 ** count))
          else
            useTerminalStore
              .getState()
              .setModeError('Connection unavailable. Start the local service, then connect again.')
        }
        ws.onerror = () => ws.close()
      }
      attempt(0)
    },
    [disconnect],
  )

  const send = useCallback(
    (message: WSOutgoing) => {
      if (message.type === 'connect') {
        connect(message.url)
        return
      }
      if (message.type === 'disconnect') {
        disconnect()
        useTerminalStore.getState().resetSession()
        return
      }
      if (message.type === 'demo_start') {
        disconnect()
        useTerminalStore.getState().resetSession()
        preview.current = startPreview()
        return
      }
      if (preview.current) {
        preview.current.send(message)
        return
      }
      if (socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(JSON.stringify(message))
      else
        useTerminalStore.getState().addToast({
          message: 'Disconnected — command was not sent. Reconnect and try again.',
          level: 'warning',
        })
      // Trading commands are deliberately never queued or replayed after reconnect.
    },
    [connect, disconnect],
  )

  useEffect(() => disconnect, [disconnect])
  return { send, ws: socket }
}
