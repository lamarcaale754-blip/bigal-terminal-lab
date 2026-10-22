import { useState } from 'react'
import type { ParseIssue, Tick } from '../core/types'
import { number, price, summarize, utc } from '../lib'

export function Watchlist({
  ticks,
  symbol,
  select,
}: {
  ticks: Tick[]
  symbol: string
  select: (symbol: string) => void
}) {
  const [query, setQuery] = useState('')
  const rows = summarize(ticks)
    .filter((row) => row.symbol.includes(query.toUpperCase()))
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
  return (
    <div className="data-panel">
      <div className="panel-tools">
        <input
          aria-label="Filter instruments"
          placeholder="Filter instruments…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span>USD · recorded observations</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Last</th>
              <th>Session Δ</th>
              <th>Observations</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((row) => (
              <tr key={row.symbol} className={symbol === row.symbol ? 'selected-row' : ''}>
                <td>
                  <button
                    className="instrument"
                    aria-pressed={symbol === row.symbol}
                    onClick={() => select(row.symbol)}
                  >
                    <span className="instrument-dot" />
                    {row.symbol}
                    <small>/ USD</small>
                  </button>
                </td>
                <td className="numeric">{price(row.last.price)}</td>
                <td className={`numeric ${row.change >= 0 ? 'positive' : 'negative'}`}>
                  {row.change >= 0 ? '+' : ''}
                  {row.change.toFixed(2)}%
                </td>
                <td className="numeric muted">{number(row.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty-state">No instruments match this view.</p>}
      </div>
      <div className="panel-note">
        {rows.length > 200
          ? `Showing 200 of ${number(rows.length)} instruments. Filter to find a specific symbol.`
          : 'Select an instrument to link the chart, tape, and session statistics.'}
      </div>
    </div>
  )
}

export function TradeTape({ ticks, symbol }: { ticks: Tick[]; symbol: string }) {
  const rows = ticks
    .filter((t) => t.symbol === symbol)
    .slice(-200)
    .reverse()
  return (
    <div className="data-panel">
      <div className="panel-tools">
        <b>{symbol} / USD</b>
        <span>Most recent 200 observations</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Time · UTC</th>
              <th>Price · USD</th>
              <th>Size · base</th>
              <th>Aggressor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="numeric muted">
                  {utc(t.ts)}
                  <span className="milliseconds">.{String(t.ts % 1000).padStart(3, '0')}</span>
                </td>
                <td className="numeric">{price(t.price)}</td>
                <td className="numeric">{t.size === undefined ? '—' : number(t.size)}</td>
                <td>
                  <span
                    className={`side-label ${t.side === 'buy' ? 'positive' : t.side === 'sell' ? 'negative' : 'muted'}`}
                  >
                    {t.side?.toUpperCase() ?? 'UNKNOWN'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty-state">No observations at this replay position.</p>}
      </div>
      <div className="panel-note">
        Recorded market prints, not account orders. Missing trade size stays unknown.
      </div>
    </div>
  )
}

export function SessionDetails({ ticks, symbol }: { ticks: Tick[]; symbol: string }) {
  const row = summarize(ticks).find((r) => r.symbol === symbol)
  if (!row) return <p className="empty-state">Select an instrument with recorded observations.</p>
  const cells = [
    ['First observed', `$${price(row.first.price)}`],
    ['Last observed', `$${price(row.last.price)}`],
    ['Observed high', `$${price(row.high)}`],
    ['Observed low', `$${price(row.low)}`],
    ['Recorded volume', row.size === null ? 'Unavailable' : `${number(row.size)} base`],
    ['Session VWAP', row.vwap === null ? 'Unavailable' : `$${price(row.vwap)}`],
  ]
  return (
    <div className="data-panel">
      <div className="panel-tools">
        <b>{symbol} / USD</b>
        <span>
          {utc(row.first.ts)} – {utc(row.last.ts)} UTC
        </span>
      </div>
      <div className="detail-grid">
        {cells.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="panel-note">
        Calculated from the visible replay prefix. Sparse observations are not a complete exchange
        feed.
      </div>
    </div>
  )
}

export function DataQuality({
  ticks,
  total,
  issues,
  duplicates,
}: {
  ticks: Tick[]
  total: number
  issues: ParseIssue[]
  duplicates: number
}) {
  const missing = ticks.filter((t) => t.size === undefined).length
  return (
    <div className="data-panel">
      <div className="quality-grid">
        <div>
          <strong>{number(total)}</strong>
          <span>Accepted records</span>
        </div>
        <div>
          <strong>{number(duplicates)}</strong>
          <span>Duplicates removed</span>
        </div>
        <div>
          <strong>{number(issues.length)}</strong>
          <span>Validation issues</span>
        </div>
        <div>
          <strong>{number(missing)}</strong>
          <span>Visible records without size</span>
        </div>
      </div>
      <div className="quality-checks">
        <p>
          <span>✓</span> Timestamp ordered · stable order for ties
        </p>
        <p>
          <span>✓</span> Positive finite prices · bounded ingestion
        </p>
        <p>
          <span>✓</span> No synthetic candles across gaps
        </p>
        <p>
          <span>✓</span> Volume and VWAP require complete size data
        </p>
      </div>
      <div className="table-scroll">
        {issues.length ? (
          issues.slice(0, 100).map((issue, i) => (
            <p className="validation-issue" key={`${issue.line}-${i}`}>
              Line {issue.line}: {issue.message}
            </p>
          ))
        ) : (
          <p className="panel-note">No validation issues in this session.</p>
        )}
      </div>
    </div>
  )
}

export interface ActivityEntry {
  id: number
  time: string
  text: string
  level: 'info' | 'warning'
}
export function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  return (
    <div className="data-panel">
      <div className="panel-tools">
        <b>Session events</b>
        <span>Local to this tab</span>
      </div>
      <div className="activity-log">
        {entries
          .slice()
          .reverse()
          .map((e) => (
            <div key={e.id}>
              <time>{e.time}</time>
              <span className={e.level === 'warning' ? 'warning' : 'positive'}>
                {e.level.toUpperCase()}
              </span>
              <p>{e.text}</p>
            </div>
          ))}
      </div>
    </div>
  )
}
