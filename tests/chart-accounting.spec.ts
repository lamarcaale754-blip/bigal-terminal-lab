import { test, expect, type WebSocketRoute } from '@playwright/test'

test('live estimates remain separate from a zero wallet balance and unavailable fees', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let socket: WebSocketRoute | undefined
  await page.routeWebSocket('ws://127.0.0.1:8765/', (route) => {
    socket = route
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect.poll(() => Boolean(socket)).toBe(true)
  socket!.send(
    JSON.stringify({
      type: 'snapshot',
      data: {
        mode: 'LIVE (LEGACY)',
        executor_type: 'legacy',
        balance: 5,
        chain_balance: 0,
        wallet_delta_sol: 0,
        actual_wallet_pnl: 0,
        pnl: 0.25,
        wins: 1,
        losses: 0,
        analytics: {},
        startup_hints: { available_modes: ['legacy'] },
        trade_history: [
          {
            ts: 1_700_000_000_000,
            time: '22:13:20',
            mint: 'FIXTURE',
            name: 'Fixture',
            symbol: 'FIXTURE',
            action: 'SELL',
            pnl_pct: 5,
            pnl_sol: 0.25,
            cum_pnl: 0.25,
            simulated: false,
            execution_confirmed: true,
          },
        ],
      },
    }),
  )
  await page.getByRole('button', { name: 'Open running session', exact: true }).click()
  await expect(
    page.getByRole('img', {
      name: 'Estimated strategy PnL in SOL from recorded trade timestamps',
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Tools', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Wallet', exact: true }).click()
  const balance = page.getByText('On-chain SOL balance', { exact: true }).locator('..')
  await expect(balance).toContainText('0.0000 SOL')
  await expect(balance).not.toContainText('5.0000')
  await expect(
    page.getByText('Estimated strategy PnL', { exact: true }).locator('..'),
  ).toContainText('+0.2500 SOL')
  await expect(
    page.getByText('Reported execution fees', { exact: true }).locator('..'),
  ).toContainText('— SOL')
  await expect(
    page.getByText('Measured wallet balance change', { exact: true }).locator('..'),
  ).toContainText('+0.0000 SOL')
  await expect(page.getByText(/Fee measurements were not reported/)).toBeVisible()
  await expect(page.getByText('Net P&L', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Gross P&L', { exact: true })).toHaveCount(0)
  socket!.send(
    JSON.stringify({
      type: 'stats',
      data: {
        chain_balance: null,
        wallet_delta_sol: null,
        actual_wallet_pnl: null,
      },
    }),
  )
  await expect(balance).toContainText('— SOL')
  await expect(
    page.getByText('Measured wallet balance change', { exact: true }).locator('..'),
  ).toContainText('— SOL')
  expect(errors).toEqual([])
})
