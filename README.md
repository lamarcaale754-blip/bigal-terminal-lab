# BigAl Terminal Lab

[![Verify and publish](https://github.com/lamarcaale754-blip/bigal-terminal-lab/actions/workflows/verify.yml/badge.svg)](https://github.com/lamarcaale754-blip/bigal-terminal-lab/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A compact trading terminal with a **React/TypeScript dashboard and an asynchronous Python strategy engine**. This public edition preserves the newer BigAl interface: dropdown menus, linked candlestick charts, candidate discovery, position management, strategy settings, and trade history.

**[Open the UI preview](https://lamarcaale754-blip.github.io/bigal-terminal-lab/)** · [Architecture](docs/ARCHITECTURE.md) · [Data contract](docs/DATA_CONTRACT.md) · [Source provenance](docs/PROVENANCE.md)

![BigAl Terminal with its original menu bar, candlestick charts, candidates, positions, and terminal log](docs/terminal.png)

The **local offline mode runs the extracted original strategy** against fictional market messages. Entries, filters, partial/full exits, trailing stops, cooldowns, and PnL are computed by the bot. No gRPC subscription or wallet is needed. The hosted Preview is a separate, clearly labeled UI fixture; its displayed trades are demonstration data.

## Run the full terminal

Requires **Node.js 22.12+** and **Python 3.11+**. CI uses Node 24 and Python on Ubuntu.

```bash
npm ci
npm run build
python -m venv .venv
```

Activate the environment:

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```

```bash
# macOS / Linux
source .venv/bin/activate
```

Then start the offline bot:

```bash
python -m pip install -r requirements.txt
python -m bot.bigalbot_customizable --offline
```

Open **http://127.0.0.1:8766**, choose **Connect**, then **Open running session**. The backend generates fictional observations and runs the actual entry/exit strategy. Allow several seconds for a candidate to meet its entry filters. Click a candidate or position to link its price chart; use **View**, **Intelligence**, and **Tools** to open panels and settings. Space pauses new entries while the bot continues managing existing positions.

To inspect just the interface, run `npm run dev` and choose **Preview**. The public Pages site also uses this browser-only preview and never automatically connects to a local backend.

## What is included

| Area                 | Implementation                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original terminal UI | Compact top menu, resizable panels, layout presets, keyboard shortcuts, command palette, virtualized tables, settings and trade journal export                 |
| Candidate discovery  | Token creation/trade ingestion, unique-buyer and volume windows, sell-ratio/net-buy/liquidity filters, age limits, bounded caches and anti-manipulation checks |
| Position lifecycle   | Entry reservation, position accounting, TP1/TP2, stop-loss, trailing exit, maximum hold, optional residual positions, cooldowns and manual exit                |
| Strategy parameters  | Source manual/adaptive/hybrid parameter resolver, dynamic hold and passive volume-exit signals, validated configuration and persisted custom presets           |
| Data correctness     | Actual observed-price OHLC, recorded trade timestamps for realized PnL, EMA9/21, quantity-dependent VWAP/volume, explicit missing data                         |
| Transport            | Typed WebSocket boundary, validated frames, bounded histories, snapshot recovery, explicit local connection and no replay of disconnected commands             |
| Execution            | Offline paper mode; source-derived ordinary Legacy HTTP execution adapter, enabled only by backend configuration                                               |
| Delivery             | Strict TypeScript, unit tests, browser workflows, Python strategy/transport tests, Docker smoke tests and GitHub Pages deployment                              |

The complete private application remains separate. This edition excludes token deployment, rug-pull orchestration, fabricated-volume operations, coordinated-wallet tooling, audio, private configuration, and runtime records. Defensive liquidity-collapse exits remain part of normal position risk management.

## Optional public feed and Legacy adapter

`python -m bot.bigalbot_customizable --feed pumpportal` enables the public market feed. It still uses paper execution until an available live mode is explicitly selected. Network availability and provider limits apply.

Ordinary Legacy execution is included as source. It requires `requirements-live.txt`, a backend-only `BIGAL_RPC_URL` and `BIGAL_PRIVATE_KEY`, and explicit `BIGAL_ENABLE_LIVE=1`. Credentials are read from process environment variables; the dashboard does not collect them, and `.env` files are not loaded automatically. Start with the public feed and select the advertised Legacy mode locally. The UI cannot enable it in offline mode. Mode changes are rejected while positions remain open.

**Live provider connectivity, signing against a real wallet, transaction settlement, and the original paid gRPC/Rust path have not been validated in this edition.** The gRPC/Rust integration remains in the private project. Tests exercise the Legacy adapter through mocks and cover failed/uncertain execution paths; they do not submit transactions. Paper fills omit real fees, slippage, competition and latency, so their results are not live performance evidence.

## Docker

```bash
# Full offline bot + dashboard; host ports bind only to loopback
docker compose up --build
```

Open **http://127.0.0.1:8766** and connect. The named volume stores the local trade journal and custom presets. No credentials are supplied to this service.

```bash
# Static UI preview only
docker build -t bigal-terminal-preview .
docker run --rm -p 127.0.0.1:8080:8080 bigal-terminal-preview
```

## Verification

```bash
npm run check
npm run test:coverage
npx playwright install chromium
npm run test:e2e
python -m pip install -r requirements-dev.txt
python -m pytest tests_python -q
```

The checks cover numerical chart behavior, malformed frames, sparse/missing measurements, menu and settings workflows, original entry/exit behavior, failed execution handling, and real loopback WebSocket/HTTP integration. Tests use synthetic inputs and mocked external execution. Coverage thresholds apply to the pure `src/core` data utilities, not the entire product.

CI verifies the production build, browser workflows, Python tests and containers before publishing the static UI preview. Docker is tested in CI. To run browser tests against an installed Edge browser on Windows, set `$env:PLAYWRIGHT_CHANNEL='msedge'` first.

## License

[MIT](LICENSE) for application source. Inter and Roboto Condensed are bundled with their open font licenses. The terminal preserves the original typography proportions and palette without redistributing proprietary font binaries. TradingView attribution is retained. See [third-party notices](THIRD_PARTY_NOTICES.md).
