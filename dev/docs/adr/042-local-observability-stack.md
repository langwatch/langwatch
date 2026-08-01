# ADR-042: Local observability stack (logs, traces, metrics → Grafana)

- **Status:** Accepted
- **Date:** 2026-07-10
- **Related:** ADR-003 (logging — prod stays on CloudWatch), ADR-004 (docker dev environment), ADR-018 (governance unified observability substrate — the *product* ingest path, distinct from this)
- **Behavioural contract:** [specs/ops/local-observability-stack.feature](../../../specs/ops/local-observability-stack.feature)

## Context

When debugging local dev, the useful signals — the app's own structured logs,
distributed traces, and runtime metrics — are scattered: Pino JSON on stdout,
zap output in the `pnpm dev` console, and traces that (by default) get dogfooded
into the local LangWatch app. An agent asked to debug a local failure has no
single, queryable place to correlate "what happened" across the TS app and the
two Go services (nlpgo, aigateway).

The plumbing to *export* was largely already there: the TS app self-instruments
with OpenTelemetry and exports traces + logs over OTLP when
`OTEL_EXPORTER_OTLP_ENDPOINT` / `PINO_OTEL_ENABLED` are set; the Go services
export traces via `otelsetup`. What was missing: (a) a collector + backends to
export *to* — there is no OTel Collector or LGTM stack deployed anywhere, and no
dev Grafana; (b) TS + Go **metrics**; (c) Go **OTLP logs**; (d) a way for an
agent to *read* the result.

Production logging deliberately uses AWS CloudWatch (ADR-003), not Loki. This
stack is strictly a **local-dev debugging aid** and must not touch the prod path.

## Decision

Ship a **local, ephemeral** observability stack plus the wiring to feed and read
it.

1. **Stack** — an `otel-lgtm` service in `compose.dev.yml` under the optional
   `observability` profile: one `grafana/otel-lgtm` container (OpenTelemetry
   Collector on `:4317`/`:4318`, fanning traces → Tempo, logs → Loki, metrics →
   Prometheus) + a pre-provisioned Grafana on `:3000`. Shared singleton (fixed
   container name + ports, no volume) so every worktree exports to the same
   collector. No persistent volume → data is ephemeral, footprint is tiny,
   retention is naturally low. Chosen over a hand-rolled multi-container LGTM
   compose for lightness, and over deploying to the shared dev cluster because
   local debugging wants per-developer isolation, no VPN/port-forward, and no
   cross-developer trace noise. Folded into `compose.dev.yml` (rather than a
   separate compose file) for discoverability; `make observability{,-down}`
   target only the `otel-lgtm` service so the rest of the dev stack is untouched.

2. **TS app** — traces + logs already flow on config alone. Added a self-
   contained global `MeterProvider` (OTLP push + `@opentelemetry/host-metrics`)
   gated on `OTEL_METRICS_ENABLED`, so all three signals reach the collector.

3. **Go services** — `otelsetup` gains an **additive** debug-collector pipeline
   gated on `OTEL_DEBUG_COLLECTOR_ENDPOINT`. When set, every span is
   *dual-exported* (a second BatchSpanProcessor on both the multi-tenant nlpgo
   path and the single-tenant aigateway path) — the primary product/ops pipeline
   is untouched — plus net-new OTLP **logs** (zap teed via the official
   `otelzap` bridge, stdout preserved) and OTLP **metrics** (Go runtime metrics).
   Empty endpoint (the default everywhere, prod included) = byte-for-byte
   unchanged. No launcher changes: the `pnpm dev` launchers already forward
   `...envFromFile`, so the `.env` var reaches both Go binaries.

4. **Reading it** — `make observability-connect` mints a Grafana service-account
   token and wires two read paths for an agent: the **`gcx` CLI** (`gcx logs/
   metrics/traces query`) and the **Grafana skills** plugins
   (`grafana-lgtm`/`grafana-core`/`grafana-datasources`).

## Consequences

- One command (`make observability` + `make observability-connect`) gives an
  agent structured logs + traces + metrics for local debugging, queryable two
  ways.
- The "some Go telemetry → LangWatch, all Go telemetry → collector" split is
  preserved: dogfooding continues, debugging gains a superset.
- New TS deps: `@opentelemetry/{sdk-metrics,exporter-metrics-otlp-proto,host-metrics}`.
  New Go deps: `otelzap` bridge, `otlplog/otlploghttp`, `otlpmetric/otlpmetrichttp`,
  `sdk/log`, `sdk/metric`, `instrumentation/runtime`.
- Ephemeral by design: restarting the stack loses history. Acceptable for
  debugging; the compose file documents how to persist + cap retention if needed.
- `grafana/otel-lgtm`'s Grafana must be v12+ for `gcx`; if the pinned image ships
  an older Grafana, the raw API still works — only `gcx` needs the bump.

## Amendment: haven owns the stack and auto-wires the split

The stack's lifecycle moved from the `compose.dev.yml` `observability` profile to
**haven** (`tools/thuishaven`, the `otellgtm` adapter): it defaults on, shares
ClickHouse's colima VM, and `make haven doctor` reports its health. `make
observability{,-connect,-down}` still work; they now front haven.

Because haven already knows when the stack is up, it stops making the developer
hand-tune `.env` and wires the console/Grafana split itself. When the collector
is running, the overlay (`.env.portless`) additionally carries:

- `LOG_CONSOLE_LEVEL=warn` — the console shows only warnings/errors while
  `info`/`debug` flow to Loki (`LOG_OTEL_LEVEL=debug`, unchanged). This reverses
  the original "haven never sets the console level" stance (it overrides `.env`,
  so it was left alone) — now an explicit, opt-outable choice via
  `LW_OBS_CONSOLE_LEVEL` (`off`/`none`/empty restores `.env`). The pretty console
  also drops the business-context fields, keeping only trace/span.
- `GRAFANA_BASE_URL` (loopback Grafana) — so the app turns a trace id into a
  clickable Grafana deep link. HTTP error bodies gain a `trace` block (ids +
  Tempo/Loki links), and the Langy error card renders a "view trace" link. Both
  are safe in production too (Grafana is access-controlled), where ops sets
  `GRAFANA_BASE_URL` instead.

See `specs/ops/local-observability-stack.feature` (the "console stays quiet" and
"error links straight to its trace" scenarios) and ADR-003.
