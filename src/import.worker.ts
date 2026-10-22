import { parseJsonl } from './core/parser'

self.onmessage = (event: MessageEvent<string>) => {
  try {
    self.postMessage({ ok: true, result: parseJsonl(event.data) })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Import failed' })
  }
}
