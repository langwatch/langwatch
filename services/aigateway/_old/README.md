# LangWatch AI Gateway

High-performance Go service that fronts LangWatch customers with a single
OpenAI-compatible and Anthropic-compatible endpoint, backed by virtual keys,
budgets, guardrails, multi-provider fallback, Anthropic cache-control
passthrough (with explicit override), and per-tenant OTLP trace routing.

Provider dispatch is delegated to `github.com/maximhq/bifrost/core` (library
only, not the Bifrost binary or transport). LangWatch owns auth, virtual keys,
budgets, guardrails, rate limits, blocked-pattern enforcement, and multi-tenant
OTel routing.

## Layout

```
cmd/gateway/             # main.go — HTTP bootstrap, signal handling, drain
internal/
  auth/                  # Virtual key → JWT bundle (LRU L1 + Redis L2 + /changes long-poll)
  blocked/               # tools / MCP / URLs / models deny+allow regex enforcement
  budget/                # Precheck (cached) + async debit outbox + live /budget/check
  cache/                 # LRU + Redis facade (used by auth bundle cache)
  cacheoverride/         # X-LangWatch-Cache header (respect / disable)
  circuit/               # Sliding-window breaker per provider credential
  config/                # Env-var config load + validate + redacted startup echo
  dispatch/              # Thin adapter over bifrost/core; provider/model routing
  fallback/              # Ordered fallback walker (5xx / timeout / rate-limit only)
  guardrails/            # Pre / post / stream_chunk verdict client, 50 ms chunk budget
  handlers/              # /v1/models, /v1/chat/completions, /v1/messages, /v1/embeddings
  health/                # /healthz /readyz /startupz + drain gate
  httpx/                 # Middleware: reqid, recover, access-log, bearer, maxbody,
                         #   inflight, version header
  logx/                  # slog bootstrap
  metrics/               # Prometheus registry — HTTP, provider, cache, outbox, breakers,
                         #   in_flight, draining, guardrail verdicts
  netcheck/              # Startup DNS+TCP probe (catches NetworkPolicy misconfig)
  otel/                  # Per-tenant OTLP routing exporter + W3C traceparent
  ratelimit/             # Per-VK RPM/RPD token bucket
pkg/gwerrors/            # OpenAI-compatible error envelope + HTTP status mapping
tests/integration/       # End-to-end tests (mock control plane + real bifrost)
```

## Running locally

```bash
cd services/gateway
GATEWAY_CONTROL_PLANE_URL=http://localhost:5560 \
GATEWAY_ALLOW_INSECURE=1 \
go run ./cmd/gateway
```

`GATEWAY_ALLOW_INSECURE=1` waives the required `LW_GATEWAY_INTERNAL_SECRET`
and `LW_GATEWAY_JWT_SECRET` for dev. Never set it in production — config
validation refuses non-loopback `GATEWAY_ADMIN_ADDR` under the same flag.

On startup the gateway logs `gateway_effective_config` with every tunable
(secrets redacted as `set(len=N)` or `unset`) so operators can verify which
overrides took effect.

## Building

```bash
go build -o bin/gateway ./cmd/gateway
```

## Testing

```bash
go test -count=1 -race ./...
```

Benchmarks in `internal/auth`, `internal/circuit`, `internal/budget`,
`internal/fallback` are compile-checked in CI (`go test -bench=. -benchtime=1x
-run=^$`) and tracked for p99 regression — see `BENCHMARKS.md` for baselines.

## Ports and listeners

| Port | Listener          | Purpose                                    |
|------|-------------------|--------------------------------------------|
| 5563 | Public HTTP       | `/v1/*`, `/healthz`, `/readyz`, `/startupz`, `/metrics` |
| 6060 | Admin (loopback)  | `/debug/pprof/*` — reach via `kubectl port-forward` or a bearer-token gate on non-loopback |

## Operator signals

Every response carries:

- `X-LangWatch-Request-Id` — per-request correlation id.
- `X-LangWatch-Gateway-Request-Id` — gateway-minted ULID for debit idempotency.
- `X-LangWatch-Gateway-Version` — running deploy (answers "which pod served this?").
- `X-LangWatch-Cache-Mode` — cache override decision on `/v1/messages` (`respect` or `disable`).
- `traceparent` — W3C propagation for client SDKs that nest spans.

Key metrics (see `internal/metrics/metrics.go` for the full list):

- `gateway_http_requests_total`, `gateway_http_request_duration_seconds`
- `gateway_provider_attempts_total`, `gateway_circuit_state`
- `gateway_auth_cache_hits_total{tier=l1|l2_redis}`, `gateway_auth_cache_misses_total`
- `gateway_budget_check_live_total`, `gateway_budget_debit_outbox_depth`,
  `_capacity`, `_dropped_total`, `_flush_failures_total`, `_4xx_drops_total`
- `gateway_guardrail_verdicts_total{direction,verdict}`
- `gateway_streaming_usage_missing_total`
- `gateway_in_flight_requests`, `gateway_draining`

## Graceful shutdown

SIGTERM triggers a four-phase drain:

1. `MarkDraining()` flips `/readyz` to 503 (`status: "draining"`).
2. Sleep `GATEWAY_SHUTDOWN_PRE_DRAIN_WAIT` (default 5 s) so LB endpoint
   removal propagates.
3. `server.Shutdown(ctx)` blocks up to `GATEWAY_SHUTDOWN_TIMEOUT` (default
   15 s) for in-flight handlers.
4. Any still-running handler is force-closed.

`terminationGracePeriodSeconds` in the Helm chart must exceed the sum of
both — the default 30 s covers the 5 s + 15 s defaults with 10 s slack.

## Contract

See `specs/ai-gateway/_shared/contract.md` in the langwatch repo for the
canonical wire contract between this gateway and the LangWatch control plane
(resolve-key, config, /changes long-poll, budget/check, budget/debit,
guardrail/check, HMAC signing scheme).

## Helm chart

`infrastructure/charts/gateway/` — see `values.yaml` for the full tunable
surface. Secrets (`LW_GATEWAY_INTERNAL_SECRET`, `LW_GATEWAY_JWT_SECRET`,
optional `LW_GATEWAY_JWT_SECRET_PREVIOUS`, optional `GATEWAY_ADMIN_AUTH_TOKEN`)
are always injected from an existing Kubernetes Secret — the chart never
materialises secret values.

NetworkPolicy is off by default (dev-friendly); enable with
`networkPolicy.enabled=true` in production. The default egress allowlist
covers kube-system DNS, the control plane on `:3000`, optional Redis on
`:6379`, and providers on `:443` minus RFC1918 ranges.
