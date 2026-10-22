import { readFile } from 'node:fs/promises'
import { test as base, expect, type Page } from '@playwright/test'

const test = base.extend<{ runtimeAudit: void }>({
  runtimeAudit: [
    async ({ page }, use) => {
      const errors: string[] = []
      const external: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      await page.route('**/*', (route) => {
        if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4173') {
          external.push(route.request().url())
          return route.abort()
        }
        return route.continue()
      })
      await use()
      expect(errors, 'No runtime errors').toEqual([])
      expect(external, 'No external services contacted').toEqual([])
    },
    { auto: true },
  ],
})

const panel = (page: Page, label: string) => page.locator(`.panel[aria-label="${label}"]`)
async function preview(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /^Preview Synthetic/ }).click()
  await expect(page.getByRole('button', { name: 'PREVIEW', exact: true })).toBeVisible()
}
async function menu(page: Page, name: string, item: string) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}
async function togglePanel(page: Page, name: string, item: string) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: item }).click()
  await page.keyboard.press('Escape')
}

test('original terminal menus and compact default panels render; preview never connects', async ({
  page,
}) => {
  const sockets: string[] = []
  page.on('websocket', (socket) => sockets.push(socket.url()))
  await page.goto('/')
  await expect(page.getByRole('dialog', { name: 'Connect BigAl Terminal' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Live Rust/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /^Live Legacy/ })).toBeDisabled()
  await page.getByRole('button', { name: /^Preview Synthetic/ }).click()
  await expect(page.locator('.workspace > .workspace-column')).toHaveCount(2)
  for (const name of ['Chart', 'Candidates', 'Positions', 'Terminal Log'])
    await expect(panel(page, name)).toBeVisible()
  for (const name of ['View', 'Intelligence', 'Tools'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(panel(page, 'Chart').locator('canvas').first()).toBeVisible()
  await expect(page.getByText('SYNTHETIC DATA', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Operations', exact: true })).toHaveCount(0)
  await togglePanel(page, 'Tools', 'Connection Health')
  await expect(panel(page, 'Connection Health')).toContainText(
    'Preview — no network endpoints connected',
  )
  expect(sockets).toEqual([])
})

test('candidate selection links observed charts and advanced overlays expose unavailable volume', async ({
  page,
}) => {
  await preview(page)
  await panel(page, 'Candidates').getByText('VECTOR', { exact: true }).click()
  await expect(
    page.getByRole('img', { name: 'VECTOR observed SOL price candlesticks' }),
  ).toBeVisible()
  await togglePanel(page, 'View', 'Advanced Chart')
  await page.getByRole('button', { name: 'Maximize Advanced Chart', exact: true }).click()
  const advanced = panel(page, 'Advanced Chart')
  await expect(
    advanced.getByRole('img', { name: 'Observed token price candlesticks in SOL' }),
  ).toBeVisible()
  await expect(advanced.getByRole('button', { name: 'VWAP', exact: true })).toBeDisabled()
  await expect(advanced).toContainText('Volume / VWAP unavailable: no complete sizes')
  await advanced.getByRole('button', { name: '1m', exact: true }).click()
  await expect(advanced.getByRole('button', { name: '1m', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await advanced.getByRole('button', { name: 'EMA 21', exact: true }).click()
  await expect(advanced.getByRole('button', { name: 'EMA 21', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await advanced.getByRole('button', { name: 'Toggle grid' }).click()
  await expect(advanced.getByRole('button', { name: 'Toggle grid' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.getByRole('button', { name: 'Restore Advanced Chart', exact: true }).click()
  await expect(panel(page, 'Candidates')).toBeVisible()
})

test('configuration presets, pause commands and simulated exits update journal and wallet', async ({
  page,
}) => {
  await preview(page)
  await menu(page, 'Tools', 'Config Panel Ctrl+,')
  await page.getByRole('button', { name: 'Risk Limits', exact: true }).click()
  const tradeSize = page.getByRole('slider', { name: 'Trade Size', exact: true })
  await expect(tradeSize).toHaveValue('0.05')
  await page.getByRole('button', { name: 'Presets', exact: true }).click()
  await page.getByRole('button', { name: 'Conservative', exact: true }).click()
  await page.getByRole('button', { name: 'Risk Limits', exact: true }).click()
  await expect(tradeSize).toHaveValue('0.025')
  await tradeSize.focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0)
  await page.keyboard.press('Control+k')
  await page.getByRole('textbox', { name: 'Find a command' }).fill('pause')
  await page.getByRole('textbox', { name: 'Find a command' }).press('Enter')
  await expect(page.getByRole('button', { name: 'PAUSED', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'PAUSED', exact: true }).click()
  await expect(page.getByRole('button', { name: 'PAUSED', exact: true })).toHaveCount(0)
  await togglePanel(page, 'View', 'Trade History')
  const historyRows = panel(page, 'Trade History').locator('tbody tr')
  await expect(historyRows).toHaveCount(24)
  await page.getByRole('button', { name: 'Sell ORBIT', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sell ORBIT', exact: true })).toHaveCount(0)
  await expect(historyRows).toHaveCount(25)
  await expect(historyRows.last()).toContainText('ORBIT')
  await expect(page.getByText('Simulated preview exit recorded')).toBeVisible()
  const downloadEvent = page.waitForEvent('download')
  await menu(page, 'Tools', 'Export Trade Journal')
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('preview-trade-journal.csv')
  const filePath = await download.path()
  expect(filePath).not.toBeNull()
  const csv = await readFile(filePath!, 'utf8')
  expect(csv).toContain('time,symbol,name,action,pnl_pct,pnl_sol,cum_pnl')
  expect(csv).toContain('PREVIEW EXIT')
  await menu(page, 'Tools', 'Wallet')
  await expect(page.getByText('Wallet', { exact: true }).last()).toBeVisible()
})

test('panel close, reopen, keyboard resize, maximize and original layout presets work', async ({
  page,
}) => {
  await preview(page)
  const chart = panel(page, 'Chart')
  const before = await chart.boundingBox()
  await page.getByRole('separator', { name: 'Resize panels' }).first().focus()
  await page.keyboard.press('ArrowDown')
  await expect
    .poll(async () => (await chart.boundingBox())?.height ?? 0)
    .toBeGreaterThan(before!.height)
  await page.getByRole('button', { name: 'Close Candidates', exact: true }).click()
  await expect(panel(page, 'Candidates')).toHaveCount(0)
  await togglePanel(page, 'View', 'Candidates')
  await expect(panel(page, 'Candidates')).toBeVisible()
  await page.getByRole('button', { name: 'Maximize Chart', exact: true }).click()
  await expect(panel(page, 'Positions')).toHaveCount(0)
  await page.getByRole('button', { name: 'Restore Chart', exact: true }).click()
  await expect(panel(page, 'Positions')).toBeVisible()
  await menu(page, 'View', 'Layout: Quick Trade')
  await expect(page.locator('.workspace .panel')).toHaveCount(2)
  await menu(page, 'View', 'Reset Layout')
  await expect(page.locator('.workspace .panel')).toHaveCount(4)
  for (const name of ['Chart', 'Candidates', 'Positions', 'Terminal Log'])
    await page.getByRole('button', { name: `Close ${name}`, exact: true }).click()
  await expect(page.getByRole('button', { name: /^Advanced Chart/ })).toBeVisible()
  await page.getByRole('button', { name: /^Advanced Chart/ }).click()
  await expect(panel(page, 'Advanced Chart')).toBeVisible()
})

test('narrow screens stack original panels and keep controls inside the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await preview(page)
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 812 })
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.body.scrollWidth <= innerWidth,
        ),
      )
      .toBe(true)
    await expect(page.getByRole('button', { name: 'View', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'PREVIEW', exact: true })).toBeInViewport()
    await panel(page, 'Terminal Log').scrollIntoViewIfNeeded()
    await expect(panel(page, 'Terminal Log')).toBeInViewport()
  }
})

interface SocketHarness {
  sent: string[]
  open: () => void
  receive: (value: unknown) => void
  close: () => void
}
declare global {
  interface Window {
    testSockets: SocketHarness[]
  }
}

test('explicit backend connection reconnects without replaying commands or accepting stale frames', async ({
  page,
}) => {
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await page.addInitScript(() => {
    window.testSockets = []
    class FakeSocket {
      static OPEN = 1
      readyState = 0
      sent: string[] = []
      onopen: ((event: Event) => void) | null = null
      onclose: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      constructor() {
        window.testSockets.push(this)
      }
      open() {
        this.readyState = 1
        this.onopen?.(new Event('open'))
      }
      receive(value: unknown) {
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(value) }))
      }
      close() {
        this.readyState = 3
        this.onclose?.(new Event('close'))
      }
      send(value: string) {
        this.sent.push(value)
      }
    }
    Object.defineProperty(window, 'WebSocket', { value: FakeSocket })
  })
  await page.goto('/')
  expect(await page.evaluate(() => window.testSockets.length)).toBe(0)
  await page.getByRole('button', { name: /^Paper Local/ }).click()
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.testSockets.length)).toBe(1)
  await page.evaluate(() => {
    const socket = window.testSockets[0]
    socket.open()
    socket.receive({
      type: 'snapshot',
      data: {
        mode: 'PAPER',
        executor_type: 'paper',
        balance: 5,
        startup_hints: { available_modes: ['paper'] },
        positions: [
          {
            mint: 'FIXTURE',
            symbol: 'FIXTURE',
            name: 'fixture',
            size_sol: 0.05,
            pnl_pct: 4,
            hold_time: 5,
            partial_sold: false,
            is_moonbag: false,
          },
        ],
      },
    })
  })
  await page.getByRole('button', { name: 'Launch Paper', exact: true }).click()
  expect(
    await page.evaluate(() => window.testSockets[0].sent.map((value) => JSON.parse(value))),
  ).toEqual([{ type: 'mode_select', mode: 'paper' }])
  await page.evaluate(() =>
    window.testSockets[0].receive({
      type: 'mode_ack',
      data: { mode: 'PAPER', balance: 5, executor_type: 'paper' },
    }),
  )
  await expect(page.getByRole('button', { name: 'Sell FIXTURE', exact: true })).toBeVisible()
  await page.evaluate(() => window.testSockets[0].close())
  await page.getByRole('button', { name: 'Sell FIXTURE', exact: true }).click()
  await expect(
    page.getByText('Disconnected — command was not sent. Reconnect and try again.'),
  ).toBeVisible()
  await page.clock.fastForward(1000)
  await expect.poll(() => page.evaluate(() => window.testSockets.length)).toBe(2)
  await page.evaluate(() => {
    window.testSockets[1].open()
    window.testSockets[0].receive({ type: 'stats', data: { positions: [] } })
  })
  await expect(page.getByRole('button', { name: 'Sell FIXTURE', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.testSockets[1].sent)).toEqual([])
  await menu(page, 'Tools', 'Connection / Mode')
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await page.clock.fastForward(20_000)
  expect(await page.evaluate(() => window.testSockets.length)).toBe(2)
})

test('documentation screenshot preserves the original dashboard with selected candlesticks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await preview(page)
  await panel(page, 'Candidates').getByText('VECTOR', { exact: true }).click()
  await expect(
    page.getByRole('img', { name: 'VECTOR observed SOL price candlesticks' }),
  ).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: 'docs/terminal.png', fullPage: true })
})
