import { readFile } from 'node:fs/promises'
import { test as base, expect, type Page } from '@playwright/test'

// Each test inspects an isolated browser context. Unexpected network traffic is
// blocked as well as reported, so the suite cannot accidentally use a real feed.
const test = base.extend<{ runtimeAudit: void }>({
  runtimeAudit: [
    async ({ page }, use) => {
      const exceptions: string[] = []
      const externalRequests: string[] = []
      page.on('pageerror', (error) => exceptions.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') exceptions.push(message.text())
      })
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== 'http://127.0.0.1:4173') {
          externalRequests.push(url.origin + url.pathname)
          return route.abort()
        }
        return route.continue()
      })
      await use()
      expect(exceptions, 'No uncaught or console runtime errors').toEqual([])
      expect(externalRequests, 'All application resources remain local').toEqual([])
    },
    { auto: true },
  ],
})

const START = Date.parse('2026-04-20T14:00:00.000Z')
const observations = [
  { id: 'a0', ts: START, symbol: 'alpha', price: 100, size: 2, side: 'buy' },
  { id: 'a1', ts: START + 10_000, symbol: 'alpha', price: 105, size: 1, side: 'sell' },
  { id: 'b0', ts: START + 15_000, symbol: 'beta', price: 50, size: 1, side: 'buy' },
  { id: 'a2', ts: START + 20_000, symbol: 'alpha', price: 98, size: 3, side: 'buy' },
  { id: 'a3', ts: START + 29_000, symbol: 'alpha', price: 103, size: 4, side: 'buy' },
  { id: 'a4', ts: START + 30_000, symbol: 'alpha', price: 104, size: 2, side: 'sell' },
  { id: 'a5', ts: START + 40_000, symbol: 'alpha', price: 110, size: 1, side: 'buy' },
  { id: 'a6', ts: START + 60_000, symbol: 'alpha', price: 108, size: 2, side: 'sell' },
  { id: 'a7', ts: START + 70_000, symbol: 'alpha', price: 106, size: 2, side: 'buy' },
]
const validJsonl = observations.map((row) => JSON.stringify(row)).join('\n')

async function importJsonl(page: Page, contents: string, name = 'hand-checked.jsonl') {
  await page.getByLabel('Import observations file').setInputFiles({
    name,
    mimeType: 'application/x-ndjson',
    buffer: Buffer.from(contents),
  })
  await expect(page.locator('.session-name')).toHaveText(name)
  await expect(page.getByRole('button', { name: 'Import JSONL' })).toBeEnabled()
}

async function seek(page: Page, timestamp: number) {
  // Use the native input value setter and a real DOM input event; no application
  // state or production helpers are exposed or accessed by the test.
  await page.getByRole('slider', { name: 'Replay position' }).evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(element, String(value))
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }, timestamp)
  await expect(page.getByRole('slider', { name: 'Replay position' })).toHaveValue(String(timestamp))
}

async function downloadedText(page: Page, button: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  const download = await pending
  const path = await download.path()
  expect(path).not.toBeNull()
  return { name: download.suggestedFilename(), text: await readFile(path!, 'utf8') }
}

test('demo boots with rendered candlesticks and no external dependencies', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('SYNTHETIC DEMO', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'ALPHA price chart', exact: true })).toBeVisible()
  const canvases = page.getByRole('img', { name: /^ALPHA price candlesticks/ }).locator('canvas')
  await expect(canvases.first()).toBeVisible()
  // The chart library also creates small axis canvases. Require a real plotting
  // surface without assuming a fixed pane height in a compact desktop layout.
  await expect
    .poll(() =>
      canvases.evaluateAll((elements) =>
        elements.some(
          (element) =>
            (element as HTMLCanvasElement).width > 200 &&
            (element as HTMLCanvasElement).height > 32,
        ),
      ),
    )
    .toBe(true)
  await expect(page.getByTestId('record-count')).toHaveText('3,120 / 4,800')
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible()
  await expect(page.locator('.chart-volume-note')).toHaveText('Volume: recorded base-asset units')
  await expect(
    page
      .getByRole('region', { name: 'Instrument watchlist', exact: true })
      .getByRole('button', { name: /^BETA/ }),
  ).toBeVisible()
})

test('replay play, pause, seek, and step reveal the event-time prefix without timer races', async ({
  page,
}) => {
  await page.goto('/')
  await importJsonl(page, validJsonl)
  await expect(page.getByTestId('record-count')).toHaveText('1 / 9')
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') })
  await page.clock.pauseAt(new Date('2030-01-01T00:01:00Z'))
  await page.getByRole('button', { name: 'Next observation' }).click()
  await expect(page.getByTestId('record-count')).toHaveText('2 / 9')
  await page.getByRole('button', { name: 'Restart replay' }).click()
  await page.getByRole('combobox', { name: 'Replay speed' }).selectOption('20')
  await page.getByRole('button', { name: 'Play replay' }).click()
  await page.clock.runFor(600)
  await expect(page.getByTestId('record-count')).toHaveText('2 / 9')
  await page.getByRole('button', { name: 'Pause replay' }).click()
  await page.clock.runFor(1_000)
  await expect(page.getByTestId('record-count')).toHaveText('2 / 9')

  await page.getByRole('button', { name: 'Play replay' }).click()
  await seek(page, START + 29_999)
  await page.clock.runFor(10_000)
  await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible()
  await expect(page.getByTestId('record-count')).toHaveText('5 / 9')
  await page.getByRole('button', { name: 'Next observation' }).click()
  await expect(page.getByTestId('record-count')).toHaveText('6 / 9')
  await seek(page, START + 70_000)
  await page.getByRole('button', { name: 'Next observation' }).click()
  await expect(page.getByTestId('record-count')).toHaveText('9 / 9')
  await expect(page.getByText('END OF SESSION', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Play replay' }).click()
  await page.clock.runFor(100)
  await expect(page.getByTestId('record-count')).toHaveText('1 / 9')
  await seek(page, START + 70_000)
  await page.clock.runFor(10_000)
  await expect(page.getByTestId('record-count')).toHaveText('9 / 9')
  await expect(page.getByText('END OF SESSION', { exact: true })).toBeVisible()
})

test('instrument selection links chart, tape, statistics, intervals, and overlays', async ({
  page,
}) => {
  await page.goto('/')
  await page
    .getByRole('region', { name: 'Instrument watchlist', exact: true })
    .getByRole('button', { name: /^BETA/ })
    .click()
  await expect(page.getByRole('region', { name: 'BETA price chart', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Trade tape', exact: true })).toContainText(
    'BETA / USD',
  )
  await expect(page.getByRole('region', { name: 'Session statistics', exact: true })).toContainText(
    'BETA / USD',
  )
  await page.getByRole('button', { name: '1m', exact: true }).click()
  await expect(page.getByRole('button', { name: '1m', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '5m', exact: true }).click()
  await expect(page.getByRole('button', { name: '5m', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('.chart-footnote')).toContainText('7 bars')
  await page.getByRole('button', { name: 'EMA 9', exact: true }).click()
  await expect(page.getByRole('button', { name: 'EMA 9', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.getByRole('button', { name: 'VWAP', exact: true }).click()
  await expect(page.getByRole('button', { name: 'VWAP', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Fit all candles in view' }).click()
})

test('local import validates rows and exports independently checked OHLC and normalized data', async ({
  page,
}) => {
  await page.goto('/')
  const withIssues = [...observations]
    .reverse()
    .map((row) => JSON.stringify({ ...row, discardedField: 'not part of contract' }))
  withIssues.push(JSON.stringify(observations[0]), '{malformed')
  await importJsonl(page, withIssues.join('\n'))
  await page
    .getByRole('navigation', { name: 'Workspace panels' })
    .getByRole('button', { name: 'Data quality', exact: true })
    .click()
  const quality = page.getByRole('region', { name: 'Data quality', exact: true })
  await expect(
    quality
      .locator('.quality-grid > div')
      .filter({ hasText: 'Accepted records' })
      .locator('strong'),
  ).toHaveText('9')
  await expect(
    quality
      .locator('.quality-grid > div')
      .filter({ hasText: 'Duplicates removed' })
      .locator('strong'),
  ).toHaveText('1')
  await expect(
    quality
      .locator('.quality-grid > div')
      .filter({ hasText: 'Validation issues' })
      .locator('strong'),
  ).toHaveText('1')
  await expect(quality).toContainText('Line 11: Invalid JSON.')

  await seek(page, START + 29_999)
  const readout = page.locator('.chart-readout')
  await expect(readout).toContainText('O 100.00')
  await expect(readout).toContainText('H 105.00')
  await expect(readout).toContainText('L 98.00')
  await expect(readout).toContainText('C 103.00')
  await expect(readout).toContainText('4 observations')
  await expect(readout).toContainText('Vol 10.00')
  const prefix = await downloadedText(page, 'Export candles')
  expect(prefix.name).toBe('ALPHA-30s-candles.csv')
  const prefixRows = prefix.text.trim().split('\n')
  expect(prefixRows).toHaveLength(2)
  const cells = prefixRows[1].split(',')
  expect(cells.slice(0, 6)).toEqual(['2026-04-20T14:00:00.000Z', '100', '105', '98', '103', '10'])
  expect(Number(cells[6])).toBeCloseTo(101.1, 10)
  expect(cells[7]).toBe('4')

  await seek(page, START + 70_000)
  await page.getByRole('button', { name: '1m', exact: true }).click()
  const minute = await downloadedText(page, 'Export candles')
  expect(minute.name).toBe('ALPHA-60s-candles.csv')
  const minuteRows = minute.text
    .trim()
    .split('\n')
    .slice(1)
    .map((row) => row.split(','))
  expect(minuteRows).toHaveLength(2)
  expect(minuteRows[0].slice(0, 6)).toEqual([
    '2026-04-20T14:00:00.000Z',
    '100',
    '110',
    '98',
    '110',
    '13',
  ])
  expect(Number(minuteRows[0][6])).toBeCloseTo(1329 / 13, 10)
  expect(minuteRows[0][7]).toBe('6')
  expect(minuteRows[1]).toEqual([
    '2026-04-20T14:01:00.000Z',
    '108',
    '108',
    '106',
    '106',
    '4',
    '107',
    '2',
  ])

  const normalized = await downloadedText(page, 'Export session')
  expect(normalized.name).toBe('observations.jsonl')
  const rows = normalized.text
    .trim()
    .split('\n')
    .map((row) => JSON.parse(row))
  expect(rows).toEqual(observations.map((row) => ({ ...row, symbol: row.symbol.toUpperCase() })))
})

test('missing sizes hide volume and VWAP; failed imports preserve the loaded session', async ({
  page,
}) => {
  await page.goto('/')
  const missing = [
    { id: 'm0', ts: START, symbol: 'MISSING', price: 12, size: 2 },
    { id: 'm1', ts: START + 1_000, symbol: 'MISSING', price: 14 },
  ]
  await importJsonl(
    page,
    missing.map((row) => JSON.stringify(row)).join('\n'),
    'missing-size.jsonl',
  )
  await expect(page.getByRole('button', { name: 'VWAP', exact: true })).toBeEnabled()
  await seek(page, START + 1_000)
  await expect(page.getByRole('button', { name: 'VWAP', exact: true })).toBeDisabled()
  await expect(page.locator('.chart-volume-note')).toContainText('unavailable')
  await expect(page.getByRole('region', { name: 'Session statistics', exact: true })).toContainText(
    'Unavailable',
  )
  const exported = await downloadedText(page, 'Export candles')
  expect(exported.text.trim().split('\n')[1].split(',')).toEqual([
    '2026-04-20T14:00:00.000Z',
    '12',
    '14',
    '12',
    '14',
    '',
    '',
    '2',
  ])

  await page.getByLabel('Import observations file').setInputFiles({
    name: 'invalid.jsonl',
    mimeType: 'application/x-ndjson',
    buffer: Buffer.from('{invalid'),
  })
  await expect(page.getByRole('alert')).toContainText('Invalid JSON')
  await expect(page.locator('.session-name')).toHaveText('missing-size.jsonl')
  await expect(page.getByTestId('record-count')).toHaveText('2 / 2')
  await expect(page.getByRole('region', { name: 'MISSING price chart', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Dismiss import error' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('workspace panels close, reopen, maximize, resize, persist, and reset', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Workspace panels' })
  await page.getByRole('button', { name: 'Maximize Price chart', exact: true }).click()
  await expect(page.locator('.workspace .panel')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Restore Price chart' })).toBeFocused()
  await page.getByRole('button', { name: 'Restore Price chart' }).click()
  await expect(page.locator('.workspace .panel')).toHaveCount(4)
  const chart = page.getByRole('region', { name: 'Price chart', exact: true })
  const before = await chart.boundingBox()
  await page.getByRole('separator').first().focus()
  await page.getByRole('separator').first().press('ArrowDown')
  await expect.poll(async () => (await chart.boundingBox())!.height).toBeGreaterThan(before!.height)
  await page.getByRole('separator').first().press('Enter')
  await expect
    .poll(async () => Math.abs((await chart.boundingBox())!.height - before!.height))
    .toBeLessThan(2)
  await page.getByRole('button', { name: 'Close Price chart', exact: true }).click()
  await expect(chart).toHaveCount(0)
  await nav.getByRole('button', { name: 'Price chart', exact: true }).click()
  await expect(chart).toBeVisible()
  await nav.getByRole('button', { name: 'Event log', exact: true }).click()
  await page.getByRole('button', { name: 'Close Trade tape', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Event log', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Trade tape', exact: true })).toHaveCount(0)
  await nav.getByRole('button', { name: 'Reset layout' }).click()
  await expect(page.locator('.workspace .panel')).toHaveCount(4)
  await expect(page.getByRole('region', { name: 'Trade tape', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Event log', exact: true })).toHaveCount(0)
  for (let index = 0; index < 4; index++) {
    await page
      .locator('.workspace')
      .getByRole('button', { name: /^Close / })
      .first()
      .click()
  }
  await expect(page.getByRole('heading', { name: 'Your workspace' })).toBeVisible()
  await page.getByRole('button', { name: 'Add Price chart panel', exact: true }).click()
  await expect(chart).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Maximize Price chart', exact: true }),
  ).toBeFocused()
})

test('narrow mobile layout keeps panels and controls usable without body overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'ALPHA price chart', exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
  await page.getByRole('button', { name: 'Maximize Price chart', exact: true }).click()
  await expect(page.locator('.workspace .panel')).toHaveCount(1)
  await page.getByRole('button', { name: 'Restore Price chart' }).click()
  await expect(page.locator('.workspace .panel')).toHaveCount(4)
  await page.getByRole('button', { name: 'Data contract', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close data contract' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.setViewportSize({ width: 320, height: 680 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true)
})
