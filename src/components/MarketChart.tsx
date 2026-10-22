import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { aggregateCandles, ema, sessionVwap } from '../core/candles'
import type { Candle, Tick } from '../core/types'

interface MarketChartProps {
  ticks: Tick[]
  symbol: string
  intervalMs: number
  onIntervalChange: (ms: number) => void
}

const colors = {
  background: '#0e1116',
  foreground: '#a4adb9',
  border: '#29313d',
  grid: 'rgba(137, 154, 176, 0.08)',
  up: '#6ac95b',
  down: '#f16a70',
  volumeUp: 'rgba(106, 201, 91, 0.28)',
  volumeDown: 'rgba(241, 106, 112, 0.28)',
  ema: '#7cdcff',
  vwap: '#ffb568',
}

const intervals = [
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
]

const priceFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
})

function formatPrice(value: number) {
  // Preserve tiny accepted observations in both the axis and accessible OHLC
  // readout. Fixed decimal rounding would otherwise turn a valid price into 0.
  if (value !== 0 && Math.abs(value) < 0.000001) return value.toExponential(6)
  return priceFormatter.format(value)
}

function formatUtc(seconds: number) {
  return new Date(seconds * 1_000).toISOString().replace('T', ' ').slice(0, 19)
}

interface ChartInstance {
  chart: IChartApi
  candles: ISeriesApi<'Candlestick'>
  volume: ISeriesApi<'Histogram'>
  ema: ISeriesApi<'Line'>
  vwap: ISeriesApi<'Line'>
}

/**
 * Charts recorded observations only. Candle gaps remain gaps; incomplete trade
 * sizes suppress volume and VWAP instead of presenting a misleading subtotal.
 */
export function MarketChart({ ticks, symbol, intervalMs, onIntervalChange }: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ChartInstance | null>(null)
  const viewportRef = useRef({ key: '', count: 0 })
  const [showEma, setShowEma] = useState(true)
  const [showVwap, setShowVwap] = useState(false)
  const [hoveredTime, setHoveredTime] = useState<number | null>(null)

  const selectedTicks = useMemo(
    () => ticks.filter((tick) => tick.symbol === symbol),
    [ticks, symbol],
  )
  const candles = useMemo(
    () => aggregateCandles(selectedTicks, symbol, intervalMs),
    [selectedTicks, symbol, intervalMs],
  )
  const priceStep = useMemo(() => {
    const smallest = candles.reduce((minimum, candle) => Math.min(minimum, candle.low), Infinity)
    return Number.isFinite(smallest)
      ? Math.min(1e-8, 10 ** (Math.floor(Math.log10(smallest)) - 6))
      : 1e-8
  }, [candles])
  const hasVolume =
    selectedTicks.length > 0 && selectedTicks.every((tick) => tick.size !== undefined)
  const emaPoints = useMemo(() => (showEma ? ema(candles, 9) : []), [candles, showEma])
  const vwapPoints = useMemo(
    () => (showVwap && hasVolume ? sessionVwap(selectedTicks, symbol, intervalMs) : []),
    [selectedTicks, symbol, intervalMs, showVwap, hasVolume],
  )
  const displayCandle = useMemo(
    () => candles.find((candle) => candle.time === hoveredTime) ?? candles.at(-1),
    [candles, hoveredTime],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      width: container.clientWidth,
      height: Math.max(100, container.clientHeight),
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.foreground,
        fontFamily:
          "'Roboto Condensed Variable', 'Roboto Condensed', 'Inter Variable', 'Inter', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#65748a', labelBackgroundColor: '#283444' },
        horzLine: { color: '#65748a', labelBackgroundColor: '#283444' },
      },
      localization: {
        locale: 'en-US',
        priceFormatter: formatPrice,
        timeFormatter: (time: Time) =>
          typeof time === 'number' ? `${formatUtc(time)} UTC` : String(time),
      },
      rightPriceScale: {
        borderColor: colors.border,
        scaleMargins: { top: 0.1, bottom: 0.26 },
      },
      timeScale: {
        borderColor: colors.border,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 4,
        barSpacing: 9,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
      handleScale: { mouseWheel: true, pinch: true },
    })

    const priceSeries = chart.addSeries(CandlestickSeries, {
      upColor: colors.up,
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      priceFormat: { type: 'custom', minMove: 0.00000001, formatter: formatPrice },
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    })
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } })
    const emaSeries = chart.addSeries(LineSeries, {
      title: 'EMA 9',
      color: colors.ema,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    })
    const vwapSeries = chart.addSeries(LineSeries, {
      title: 'VWAP',
      color: colors.vwap,
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    })
    chartRef.current = {
      chart,
      candles: priceSeries,
      volume: volumeSeries,
      ema: emaSeries,
      vwap: vwapSeries,
    }
    viewportRef.current = { key: '', count: 0 }

    const onCrosshair = (param: MouseEventParams) => {
      const candle = param.seriesData.get(priceSeries)
      setHoveredTime(candle && typeof param.time === 'number' ? param.time : null)
    }
    chart.subscribeCrosshairMove(onCrosshair)
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) chart.resize(Math.floor(width), Math.floor(height))
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      chart.unsubscribeCrosshairMove(onCrosshair)
      chart.remove()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const instance = chartRef.current
    if (!instance) return
    // Construct the power of ten directly: 1 / 1e-18 is not exactly 1e18 in
    // JavaScript, which the chart library rejects as an unsupported base.
    const base = 10 ** -Math.round(Math.log10(priceStep))
    const priceFormat = {
      type: 'custom' as const,
      minMove: priceStep,
      base,
      formatter: formatPrice,
    }
    instance.candles.applyOptions({ priceFormat })
    instance.ema.applyOptions({ priceFormat })
    instance.vwap.applyOptions({ priceFormat })
  }, [priceStep])

  useEffect(() => {
    const instance = chartRef.current
    if (!instance) return
    const { chart, candles: priceSeries, volume, ema: emaSeries, vwap } = instance
    const previousRange = chart.timeScale().getVisibleLogicalRange()
    const key = `${symbol}:${intervalMs}`
    const previous = viewportRef.current

    priceSeries.setData(
      candles.map(
        ({ time, open, high, low, close }) =>
          ({
            time: time as UTCTimestamp,
            open,
            high,
            low,
            close,
          }) satisfies CandlestickData,
      ),
    )
    volume.setData(
      hasVolume
        ? candles.flatMap((candle) =>
            candle.volume === null
              ? []
              : [
                  {
                    time: candle.time as UTCTimestamp,
                    value: candle.volume,
                    color: candle.close >= candle.open ? colors.volumeUp : colors.volumeDown,
                  },
                ],
          )
        : [],
    )
    volume.applyOptions({ visible: hasVolume })
    emaSeries.setData(emaPoints.map((point) => ({ ...point, time: point.time as UTCTimestamp })))
    vwap.setData(vwapPoints.map((point) => ({ ...point, time: point.time as UTCTimestamp })))

    if (candles.length > 0 && (previous.key !== key || previous.count === 0)) {
      chart.timeScale().fitContent()
    } else if (
      previousRange &&
      candles.length > 0 &&
      candles.length < previous.count &&
      previousRange.from >= candles.length - 1
    ) {
      // Seeking behind a panned viewport must not leave an apparently empty
      // chart. Preserve the user's zoom while bringing the final bar into view.
      const to = candles.length + 3
      chart
        .timeScale()
        .setVisibleLogicalRange({ from: to - (previousRange.to - previousRange.from), to })
    }
    viewportRef.current = { key, count: candles.length }
  }, [candles, emaPoints, vwapPoints, symbol, intervalMs, hasVolume])

  return (
    <section className="market-chart" aria-label={`${symbol} price chart`}>
      <div className="chart-toolbar">
        <div className="chart-heading">
          <strong>{symbol || 'Select a symbol'}</strong>
          <span> / USD · OHLC</span>
        </div>
        <div className="chart-controls">
          <div className="chart-intervals" role="group" aria-label="Candle interval">
            {intervals.map((interval) => (
              <button
                key={interval.ms}
                type="button"
                aria-pressed={intervalMs === interval.ms}
                onClick={() => onIntervalChange(interval.ms)}
              >
                {interval.label}
              </button>
            ))}
          </div>
          <button
            className="chart-overlay-toggle"
            type="button"
            aria-pressed={showEma}
            onClick={() => setShowEma((value) => !value)}
          >
            <span style={{ color: colors.ema }} aria-hidden="true">
              ●{' '}
            </span>
            EMA 9
          </button>
          <button
            className="chart-overlay-toggle"
            type="button"
            aria-pressed={showVwap && hasVolume}
            disabled={!hasVolume}
            title={
              hasVolume
                ? 'Session volume-weighted average price'
                : 'Requires a recorded size for every observation'
            }
            onClick={() => setShowVwap((value) => !value)}
          >
            <span style={{ color: colors.vwap }} aria-hidden="true">
              ●{' '}
            </span>
            VWAP
          </button>
          <button
            type="button"
            onClick={() => chartRef.current?.chart.timeScale().fitContent()}
            disabled={!candles.length}
            aria-label="Fit all candles in view"
          >
            Fit view
          </button>
        </div>
      </div>
      <div className="chart-readout" style={{ minHeight: 32 }}>
        {displayCandle ? (
          <CandleReadout candle={displayCandle} hasVolume={hasVolume} />
        ) : (
          <span>No recorded observations in view</span>
        )}
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 100 }}>
        <div
          ref={containerRef}
          className="chart-viewport"
          style={{ position: 'absolute', inset: 0, height: '100%', width: '100%' }}
          role="img"
          aria-label={`${symbol} price candlesticks in US dollars. The candle values are provided above the chart.`}
        />
        {!candles.length && (
          <div
            className="chart-empty"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              pointerEvents: 'none',
            }}
          >
            Play the recording or import observations to begin.
          </div>
        )}
      </div>
      <div className="chart-footnote">
        <span>
          Candles from recorded observations · UTC · {candles.length.toLocaleString()} bars
        </span>
        <span className="chart-volume-note">
          {hasVolume
            ? 'Volume: recorded base-asset units'
            : selectedTicks.length
              ? 'Volume / VWAP unavailable: observations lack trade sizes'
              : 'Volume / VWAP: awaiting observations'}
        </span>
      </div>
    </section>
  )
}

function CandleReadout({ candle, hasVolume }: { candle: Candle; hasVolume: boolean }) {
  const color = candle.close >= candle.open ? colors.up : colors.down
  return (
    <>
      <time dateTime={new Date(candle.time * 1_000).toISOString()}>
        {formatUtc(candle.time)} UTC
      </time>
      {(
        [
          ['O', candle.open],
          ['H', candle.high],
          ['L', candle.low],
          ['C', candle.close],
        ] as const
      ).map(([label, value]) => (
        <span key={label}>
          {label} <strong style={{ color }}>{formatPrice(value)}</strong>
        </span>
      ))}
      <span>{candle.samples.toLocaleString()} observations</span>
      {hasVolume && candle.volume !== null && <span>Vol {formatPrice(candle.volume)}</span>}
    </>
  )
}
