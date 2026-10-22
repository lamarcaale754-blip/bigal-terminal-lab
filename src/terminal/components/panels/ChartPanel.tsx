import { useRef, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import {
  createChart,
  ColorType,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type Time,
} from 'lightweight-charts'
import { useTerminalStore } from '../../stores/terminalStore'
import { useLinkedContext } from '../../hooks/useLinkedContext'
import { aggregateCandles } from '../../../core/candles'
import {
  recordedPnlCandles,
  formatChartValue as formatValue,
  chartPriceBase,
  pnlLabels,
} from '../../lib/chartData'

/** Original compact terminal chart palette and stacked panel presentation. */
const THEME = {
  bg: '#0E0E0E',
  gridColor: 'rgba(64, 64, 64, 0.2)',
  textColor: '#808080',
  crosshairColor: '#505050',
  labelBg: '#181818',
  borderColor: '#2A2A2A',
  upColor: '#5CBF4A',
  downColor: '#E01616',
  wickUp: '#5CBF4A80',
  wickDown: '#E0161680',
}

function createTerminalChart(container: HTMLElement): IChartApi {
  return createChart(container, {
    width: Math.max(1, container.clientWidth),
    height: Math.max(1, container.clientHeight),
    layout: {
      background: { type: ColorType.Solid, color: THEME.bg },
      textColor: THEME.textColor,
      fontFamily: "'Roboto Condensed Variable', 'Inter Variable', sans-serif",
      fontSize: 10,
    },
    grid: { vertLines: { color: THEME.gridColor }, horzLines: { color: THEME.gridColor } },
    crosshair: {
      vertLine: {
        color: THEME.crosshairColor,
        width: 1,
        style: 2,
        labelBackgroundColor: THEME.labelBg,
      },
      horzLine: {
        color: THEME.crosshairColor,
        width: 1,
        style: 2,
        labelBackgroundColor: THEME.labelBg,
      },
    },
    localization: {
      timeFormatter: (time: Time) =>
        typeof time === 'number'
          ? `${new Date(time * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`
          : String(time),
    },
    rightPriceScale: { borderColor: THEME.borderColor, scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: {
      borderColor: THEME.borderColor,
      timeVisible: true,
      secondsVisible: true,
      rightOffset: 3,
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true },
  })
}

const candleOptions = {
  upColor: THEME.upColor,
  downColor: THEME.downColor,
  borderUpColor: THEME.upColor,
  borderDownColor: THEME.downColor,
  wickUpColor: THEME.wickUp,
  wickDownColor: THEME.wickDown,
}

/** Per-trade PnL impact, grouped only when recorded events share a UTC second. */
function PnLChart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const initializedRef = useRef(false)
  const trades = useTerminalStore((state) => state.trades)
  const mode = useTerminalStore((state) => state.mode)
  const labels = pnlLabels(mode)
  const { candles, omitted } = useMemo(() => recordedPnlCandles(trades), [trades])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = createTerminalChart(container)
    const series = chart.addSeries(CandlestickSeries, {
      ...candleOptions,
      priceFormat: {
        type: 'custom',
        minMove: 1e-8,
        base: 1e8,
        formatter: (value: number) => `${value >= 0 ? '+' : ''}${formatValue(value)}`,
      },
    })
    chartRef.current = chart
    seriesRef.current = series
    initializedRef.current = false
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0)
        chart.resize(Math.floor(entry.contentRect.width), Math.floor(entry.contentRect.height))
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    const base = chartPriceBase(candles)
    seriesRef.current?.applyOptions({
      priceFormat: {
        type: 'custom',
        minMove: 1 / base,
        base,
        formatter: (value: number) => `${value >= 0 ? '+' : ''}${formatValue(value)}`,
      },
    })
    seriesRef.current?.setData(
      candles.map(({ time, open, high, low, close }) => ({
        time: time as UTCTimestamp,
        open,
        high,
        low,
        close,
      })),
    )
    if (candles.length && !initializedRef.current) {
      chartRef.current?.timeScale().fitContent()
      initializedRef.current = true
    }
    if (!candles.length) initializedRef.current = false
  }, [candles])

  return (
    <>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        role="img"
        aria-label={`${labels.title} in SOL from recorded trade timestamps`}
        title={labels.description}
      />
      {!candles.length && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--dim)',
            fontSize: 11,
            pointerEvents: 'none',
            padding: 15,
            textAlign: 'center',
          }}
        >
          No timestamped trade history available.
        </div>
      )}
      {omitted > 0 && (
        <span
          style={{
            position: 'absolute',
            bottom: 27,
            left: 8,
            color: 'var(--dim)',
            fontSize: 9,
            pointerEvents: 'none',
          }}
        >
          {omitted} trades omitted: missing recorded time or PnL.
        </span>
      )}
    </>
  )
}

/** The original small token chart, fed by actual SOL price observations. */
function TokenCandleChart({
  mint,
  label,
  onRemove,
}: {
  mint: string
  label: string
  onRemove: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const initializedRef = useRef(false)
  const ticks = useTerminalStore((state) => state.chartTicks)
  const timestampSource = useTerminalStore((state) => state.chartTimestampSource)
  const candles = useMemo(() => aggregateCandles(ticks, mint, 15_000), [ticks, mint])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = createTerminalChart(container)
    const series = chart.addSeries(CandlestickSeries, {
      ...candleOptions,
      priceFormat: { type: 'custom', minMove: 1e-8, base: 1e8, formatter: formatValue },
    })
    chartRef.current = chart
    seriesRef.current = series
    initializedRef.current = false
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0)
        chart.resize(Math.floor(entry.contentRect.width), Math.floor(entry.contentRect.height))
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    const base = chartPriceBase(candles)
    seriesRef.current?.applyOptions({
      priceFormat: { type: 'custom', minMove: 1 / base, base, formatter: formatValue },
    })
    seriesRef.current?.setData(
      candles.map(({ time, open, high, low, close }) => ({
        time: time as UTCTimestamp,
        open,
        high,
        low,
        close,
      })),
    )
    if (candles.length && !initializedRef.current) {
      chartRef.current?.timeScale().fitContent()
      initializedRef.current = true
    }
    if (!candles.length) initializedRef.current = false
  }, [candles])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--bdr)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '2px 8px',
          background: 'var(--bg-elevated)',
          borderBottom: '1px solid var(--bdr)',
          fontSize: 'var(--text-xs)',
          height: 20,
        }}
      >
        <span style={{ color: '#7CDCFF', fontFamily: 'var(--font-data)', fontWeight: 500 }}>
          {label}
        </span>
        <span
          style={{
            color: 'var(--dim)',
            marginLeft: 6,
            fontFamily: 'var(--font-data)',
            fontSize: 9,
          }}
        >
          {mint.slice(0, 8)}… · SOL · 15s ·{' '}
          {timestampSource === 'mixed' ? 'event/receipt' : timestampSource} UTC
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onRemove}
          aria-label={`Remove ${label} chart`}
          style={{ color: 'var(--dim)', fontSize: 10, padding: '0 4px' }}
        >
          <span style={{ fontSize: 11 }}>&times;</span>
        </button>
      </div>
      <div style={{ position: 'relative', height: 100 }}>
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%' }}
          role="img"
          aria-label={`${label} observed SOL price candlesticks`}
        />
        {!candles.length && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--dim)',
              fontSize: 10,
              pointerEvents: 'none',
            }}
          >
            Waiting for observed price history.
          </div>
        )}
      </div>
    </div>
  )
}

function tokenLabel(mint: string): { mint: string; label: string } {
  const state = useTerminalStore.getState()
  const candidate = state.candidateFeed.find((row) => row.mint === mint)
  const position = state.positions.find((row) => row.mint === mint)
  return {
    mint,
    label: candidate?.symbol || position?.symbol || position?.name || mint.slice(0, 6),
  }
}

export function ChartPanel() {
  const mode = useTerminalStore((state) => state.mode)
  const labels = pnlLabels(mode)
  const [watchedTokens, setWatchedTokens] = useState<{ mint: string; label: string }[]>(() => {
    const mint = useLinkedContext.getState().selectedMint
    return mint ? [tokenLabel(mint)] : []
  })
  useEffect(
    () =>
      useLinkedContext.subscribe((state, previous) => {
        if (!state.selectedMint || state.selectedMint === previous.selectedMint) return
        const token = tokenLabel(state.selectedMint)
        setWatchedTokens((current) =>
          current.some((row) => row.mint === token.mint) ? current : [...current, token].slice(-4),
        )
      }),
    [],
  )
  const removeToken = useCallback(
    (mint: string) => setWatchedTokens((current) => current.filter((row) => row.mint !== mint)),
    [],
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        overflow: 'hidden',
        height: '100%',
      }}
    >
      <div
        style={{
          flex: watchedTokens.length > 0 ? '0 0 45%' : 1,
          minHeight: 80,
          borderBottom: watchedTokens.length > 0 ? '1px solid var(--bdr)' : 'none',
          position: 'relative',
        }}
      >
        <PnLChart />
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 10,
            font: '600 9px var(--font-data)',
            color: 'var(--green)',
            opacity: 0.5,
            letterSpacing: '0.5px',
            pointerEvents: 'none',
          }}
        >
          {labels.title.toUpperCase()} · SOL · RECORDED UTC
        </div>
      </div>
      {watchedTokens.length > 0 && (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {watchedTokens.map((token) => (
            <TokenCandleChart
              key={token.mint}
              mint={token.mint}
              label={token.label}
              onRemove={() => removeToken(token.mint)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      style={{
        height: 'var(--panel-header)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        borderBottom: '1px solid var(--bdr)',
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-ui)',
        fontWeight: 600,
        color: 'var(--dim)',
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        flexShrink: 0,
        background: 'var(--bg-elevated)',
      }}
    >
      {title}
      <div style={{ flex: 1 }} />
      {children}
    </div>
  )
}
