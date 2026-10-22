# Engineering decisions

## Preserve the terminal's actual interface and strategy

The public edition keeps the original React components and ordinary strategy paths so an engineer can follow an event from candidate discovery through entry, position management and journal output. Unsupported or private modules are removed from the panel registry and configuration, rather than represented by fake buttons or random data.

## Separate a UI preview from a paper backend

GitHub Pages can host the interface but cannot run Python. Preview therefore demonstrates the UI with labeled fictional state. Local offline mode runs the actual strategy against deterministic market messages. This distinction keeps the public preview easy to inspect without treating canned demonstration trades as strategy evidence.

## Treat chart data as measurements

Candlestick wicks are observed extrema. A bonding-curve progress percentage is never a token price. Event/receipt times are labeled; missing trade timestamps do not become fabricated wall-clock history. Volume and VWAP require complete executed-size observations. PnL candles describe changes in recorded cumulative PnL, including a retained history's actual starting baseline.

## Keep execution behind backend capabilities

The UI shows which executors the backend can actually use. Offline mode cannot switch into live execution. Keys stay in environment variables on the backend. Ordinary Legacy code remains inspectable and mock-tested, while the paid gRPC/Rust integration stays private. A disconnected dashboard never queues trading commands for later execution.

## Bound state and expose failure

WebSocket frame size, input lengths, candidate caches and UI histories are bounded. Reconnect uses snapshots rather than stale command replay. Failed exits retain positions; uncertain execution requires attention rather than silently retrying a potentially landed transaction. Unmeasured latency remains unavailable.

## Use a local service with a small deployment surface

The Python process serves the built UI and its WebSocket on loopback. An offline Docker service is reproducible without wallet secrets or subscriptions. This simplifies inspection and testing; it deliberately does not claim production hosting, authenticated multi-user sessions or durable recovery of live orders.
