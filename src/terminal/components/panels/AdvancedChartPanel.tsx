import { useRef, useEffect, useState, useCallback, useMemo, type CSSProperties } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type UTCTimestamp,
  type Time,
} from 'lightweight-charts'
import { useTerminalStore } from '../../stores/terminalStore'
import { useLinkedContext } from '../../hooks/useLinkedContext'
import { aggregateCandles, ema, sessionVwap } from '../../../core/candles'
import {
  recordedPnlCandles,
  formatChartValue as formatValue,
  chartPriceBase,
  pnlLabels,
} from '../../lib/chartData'
import { Crosshair, Maximize2, Grid3X3 } from 'lucide-react'

const THEME = {
  bg: '#0E0E0E',
  gridColor: 'rgba(64, 64, 64, 0.15)',
  textColor: '#808080',
  crosshairColor: '#505050',
  labelBg: '#181818',
  borderColor: '#2A2A2A',
  upColor: '#5CBF4A',
  downColor: '#E01616',
  wickUp: '#5CBF4A80',
  wickDown: '#E0161680',
  volumeUp: 'rgba(92, 191, 74, 0.25)',
  volumeDown: 'rgba(224, 22, 22, 0.25)',
}
const TIMEFRAMES = [
  { label: '1s', seconds: 1 },
  { label: '5s', seconds: 5 },
  { label: '15s', seconds: 15 },
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
]
const OVERLAYS = [
  { id: 'ema9', label: 'EMA 9', color: '#7CDCFF' },
  { id: 'ema21', label: 'EMA 21', color: '#F8AAFF' },
  { id: 'vwap', label: 'VWAP', color: '#FF9100' },
]

function createPrecisionChart(container: HTMLElement): IChartApi {
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
      mode: CrosshairMode.Normal,
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
    rightPriceScale: {
      borderColor: THEME.borderColor,
      scaleMargins: { top: 0.08, bottom: 0.2 },
      mode: 0,
    },
    timeScale: {
      borderColor: THEME.borderColor,
      timeVisible: true,
      secondsVisible: true,
      rightOffset: 5,
      barSpacing: 8,
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true },
  })
}

/** Original advanced toolbar and layout; every plotted value has an observation. */
export function AdvancedChartPanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const overlaySeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const viewportRef = useRef({ key: '', count: 0 })
  const [activeTimeframe, setActiveTimeframe] = useState(2)
  const [activeOverlays, setActiveOverlays] = useState<Set<string>>(new Set(['ema9']))
  const [hoveredTime, setHoveredTime] = useState<number | null>(null)
  const [crosshairVisible, setCrosshairVisible] = useState(true)
  const [gridVisible, setGridVisible] = useState(true)
  const selectedMint = useLinkedContext((state) => state.selectedMint)
  const ticks = useTerminalStore((state) => state.chartTicks)
  const timestampSource = useTerminalStore((state) => state.chartTimestampSource)
  const trades = useTerminalStore((state) => state.trades)
  const mode = useTerminalStore((state) => state.mode)
  const labels = pnlLabels(mode)
  const selectedTicks = useMemo(
    () => ticks.filter((tick) => tick.symbol === selectedMint),
    [ticks, selectedMint],
  )
  const intervalMs = TIMEFRAMES[activeTimeframe].seconds * 1000
  const { candles, omitted } = useMemo(() => {
    if (selectedMint)
      return { candles: aggregateCandles(selectedTicks, selectedMint, intervalMs), omitted: 0 }
    return recordedPnlCandles(trades, intervalMs)
  }, [selectedTicks, selectedMint, trades, intervalMs])
  const hasVolume =
    selectedTicks.length > 0 && selectedTicks.every((tick) => tick.size !== undefined)
  const shownCandle = useMemo(
    () => candles.find((candle) => candle.time === hoveredTime) ?? candles.at(-1),
    [candles, hoveredTime],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = createPrecisionChart(container)
    const priceFormat = {
      type: 'custom' as const,
      minMove: 1e-8,
      base: 1e8,
      formatter: formatValue,
    }
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: THEME.upColor,
      downColor: THEME.downColor,
      borderUpColor: THEME.upColor,
      borderDownColor: THEME.downColor,
      wickUpColor: THEME.wickUp,
      wickDownColor: THEME.wickDown,
      priceFormat,
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    })
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
    for (const overlay of OVERLAYS)
      overlaySeriesRef.current.set(
        overlay.id,
        chart.addSeries(LineSeries, {
          color: overlay.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat,
        }),
      )
    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries
    viewportRef.current = { key: '', count: 0 }
    const onCrosshair = (event: MouseEventParams) =>
      setHoveredTime(
        event.seriesData.has(candleSeries) && typeof event.time === 'number' ? event.time : null,
      )
    chart.subscribeCrosshairMove(onCrosshair)
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0)
        chart.resize(Math.floor(entry.contentRect.width), Math.floor(entry.contentRect.height))
    })
    observer.observe(container)
    const overlays = overlaySeriesRef.current
    return () => {
      observer.disconnect()
      chart.unsubscribeCrosshairMove(onCrosshair)
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      overlays.clear()
    }
  }, [])

  useEffect(() => {
    chartRef.current?.applyOptions({
      grid: { vertLines: { visible: gridVisible }, horzLines: { visible: gridVisible } },
      crosshair: { mode: crosshairVisible ? CrosshairMode.Normal : CrosshairMode.Hidden },
    })
  }, [gridVisible, crosshairVisible])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !candleSeriesRef.current || !volumeSeriesRef.current) return
    const range = chart.timeScale().getVisibleLogicalRange()
    const key = `${selectedMint ?? 'pnl'}:${intervalMs}`
    const previous = viewportRef.current
    const base = chartPriceBase(candles)
    const priceFormat = { type: 'custom' as const, minMove: 1 / base, base, formatter: formatValue }
    candleSeriesRef.current.applyOptions({ priceFormat })
    candleSeriesRef.current.setData(
      candles.map(({ time, open, high, low, close }) => ({
        time: time as UTCTimestamp,
        open,
        high,
        low,
        close,
      })),
    )
    volumeSeriesRef.current.setData(
      hasVolume
        ? candles.flatMap((candle) =>
            candle.volume === null
              ? []
              : [
                  {
                    time: candle.time as UTCTimestamp,
                    value: candle.volume,
                    color: candle.close >= candle.open ? THEME.volumeUp : THEME.volumeDown,
                  },
                ],
          )
        : [],
    )
    volumeSeriesRef.current.applyOptions({ visible: hasVolume })
    chart
      .priceScale('right')
      .applyOptions({ scaleMargins: { top: 0.08, bottom: hasVolume ? 0.2 : 0.08 } })
    for (const [id, series] of overlaySeriesRef.current) {
      series.applyOptions({ priceFormat })
      const points = !activeOverlays.has(id)
        ? []
        : id === 'vwap'
          ? hasVolume && selectedMint
            ? sessionVwap(selectedTicks, selectedMint, intervalMs)
            : []
          : ema(candles, id === 'ema9' ? 9 : 21)
      series.setData(points.map((point) => ({ ...point, time: point.time as UTCTimestamp })))
    }
    if (candles.length > 0 && (previous.key !== key || previous.count === 0))
      chart.timeScale().fitContent()
    else if (
      range &&
      candles.length > 0 &&
      candles.length < previous.count &&
      range.from >= candles.length - 1
    ) {
      const to = candles.length + 3
      chart.timeScale().setVisibleLogicalRange({ from: to - (range.to - range.from), to })
    }
    viewportRef.current = { key, count: candles.length }
  }, [candles, activeOverlays, selectedTicks, selectedMint, intervalMs, hasVolume])

  const toggleOverlay = useCallback(
    (id: string) =>
      setActiveOverlays((previous) => {
        const next = new Set(previous)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    [],
  )
  const change =
    shownCandle && selectedMint && shownCandle.open !== 0
      ? ((shownCandle.close - shownCandle.open) / Math.abs(shownCandle.open)) * 100
      : null
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg)',
        position: 'relative',
      }}
    >
      <div className="adv-chart-toolbar">
        <div className="adv-chart-toolbar__group" role="group" aria-label="Advanced chart interval">
          {TIMEFRAMES.map((timeframe, index) => (
            <button
              key={timeframe.label}
              className={`adv-chart-tf-btn ${index === activeTimeframe ? 'adv-chart-tf-btn--active' : ''}`}
              aria-pressed={index === activeTimeframe}
              onClick={() => setActiveTimeframe(index)}
            >
              {timeframe.label}
            </button>
          ))}
        </div>
        <div className="adv-chart-toolbar__sep" />
        <div className="adv-chart-toolbar__group" role="group" aria-label="Chart overlays">
          {OVERLAYS.map((overlay) => (
            <button
              key={overlay.id}
              className={`adv-chart-overlay-btn ${activeOverlays.has(overlay.id) && (overlay.id !== 'vwap' || hasVolume) ? 'adv-chart-overlay-btn--active' : ''}`}
              aria-pressed={activeOverlays.has(overlay.id) && (overlay.id !== 'vwap' || hasVolume)}
              disabled={overlay.id === 'vwap' && !hasVolume}
              title={
                overlay.id === 'vwap' && !hasVolume
                  ? 'Requires recorded executed sizes for every price observation'
                  : overlay.label
              }
              onClick={() => toggleOverlay(overlay.id)}
              style={{ '--overlay-color': overlay.color } as CSSProperties}
            >
              <span className="adv-chart-overlay-btn__dot" />
              {overlay.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {shownCandle && (
          <div
            className="adv-chart-crosshair-data"
            title={`O ${formatValue(shownCandle.open)} · H ${formatValue(shownCandle.high)} · L ${formatValue(shownCandle.low)} · C ${formatValue(shownCandle.close)} SOL`}
          >
            <span style={{ color: 'var(--txt-bright)' }}>{formatValue(shownCandle.close)} SOL</span>
            {change !== null && (
              <span style={{ color: change >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                {change >= 0 ? '+' : ''}
                {change.toFixed(2)}%
              </span>
            )}
            <span style={{ color: 'var(--dim)' }}>
              {new Date(shownCandle.time * 1000).toISOString().slice(11, 19)} UTC
            </span>
          </div>
        )}
        <div className="adv-chart-toolbar__group">
          <button
            className="adv-chart-tool-btn"
            title="Toggle crosshair"
            aria-label="Toggle crosshair"
            aria-pressed={crosshairVisible}
            onClick={() => setCrosshairVisible((value) => !value)}
          >
            <Crosshair size={12} />
          </button>
          <button
            className="adv-chart-tool-btn"
            title="Fit content"
            aria-label="Fit chart content"
            onClick={() => chartRef.current?.timeScale().fitContent()}
          >
            <Maximize2 size={12} />
          </button>
          <button
            className="adv-chart-tool-btn"
            title="Toggle grid"
            aria-label="Toggle grid"
            aria-pressed={gridVisible}
            onClick={() => setGridVisible((value) => !value)}
          >
            <Grid3X3 size={12} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 80, position: 'relative' }}>
        <div
          ref={containerRef}
          style={{ position: 'absolute', inset: 0 }}
          role="img"
          aria-label={
            selectedMint
              ? 'Observed token price candlesticks in SOL'
              : `${labels.title} candlesticks in SOL`
          }
        />
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 10,
            font: '600 9px var(--font-data)',
            color: 'var(--cyan)',
            opacity: 0.5,
            letterSpacing: '0.5px',
            pointerEvents: 'none',
          }}
        >
          {selectedMint
            ? `TOKEN ${selectedMint.slice(0, 8)}… · SOL`
            : `${labels.title.toUpperCase()} · SOL`}
        </div>
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
            }}
          >
            {selectedMint
              ? 'Waiting for observed price history.'
              : 'No timestamped trade history available.'}
          </div>
        )}
      </div>
      <div
        style={{
          flexShrink: 0,
          padding: '3px 8px',
          color: 'var(--dim)',
          fontSize: 9,
          borderTop: '1px solid var(--bdr)',
        }}
      >
        {selectedMint
          ? `Observed prices · ${timestampSource === 'mixed' ? 'event/receipt' : timestampSource} UTC · ${hasVolume ? 'Recorded token volume' : 'Volume / VWAP unavailable: no complete sizes'}`
          : `${labels.description} · recorded trade UTC${omitted ? ` · ${omitted} trades omitted: missing time or PnL` : ''}`}
      </div>
    </div>
  )
}
