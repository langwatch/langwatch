# svc_aigateway

## Description

AI Gateway is the data-plane proxy that sits between customers and LLM
providers. It resolves virtual keys into provider credentials, enforces budgets,
rate limits, guardrails, and policy rules, then dispatches requests via Bifrost.
Per-tenant OTLP traces are emitted for every completion.

## Architecture

Hexagonal (ports and adapters):

```
cmd/root.go              Entry point: LoadConfig → NewDeps → app.New → Serve
config.go                Environment-variable configuration
deps.go                  Infrastructure adapter construction (DI root)
serve.go                 HTTP server lifecycle (chi + lifecycle.Group)

domain/                  Pure types — no dependencies
  provider.go            ProviderID enum, Credential, Provider interface
  request.go             Request, RequestType, RequestMetadata
  response.go            Response, StreamIterator, Usage
  bundle.go              Bundle, BundleConfig, all sub-configs
  model.go               ResolvedModel, ModelSource
  verdict.go             BudgetVerdict, GuardrailVerdict, CacheDecision
  errors.go              Domain error codes

app/                     Application layer — orchestration via interfaces
  app.go                 App struct, Option funcs, pipeline construction
  ports.go               Port interfaces (AuthResolver, ProviderRouter, etc.)
  handlers.go            HandleChat, HandleChatStream, HandleMessages, etc.
  pipeline/              Interceptor chain framework
    pipeline.go          Build(), Call, Meta, Interceptor types
    ratelimit.go         RPM/RPD gate
    policy.go            Tool/MCP/URL deny/allow matching
    resolve.go           Model alias/allowlist resolution
    cache.go             Cache rule evaluation + body mutation
    cachecontrol.go      Cache-control body rewriting
    budget.go            Pre-check gate + post-dispatch debit
    guardrail.go         Pre/post/chunk guardrail evaluation
    trace.go             Customer trace span lifecycle

adapters/                Infrastructure implementations
  httpapi/               chi router, auth + trace-registry middleware
  controlplane/          HMAC-signed HTTP client, JWT verify, guardrails RPC
  authresolver/          3-tier cache (L1 LRU → L2 store → L3 upstream)
  providers/             Bifrost router (multi-provider dispatch)
  modelresolver/         Alias → explicit → implicit resolution
  ratelimit/             In-memory token bucket (per-VK LRU)
  budget/                Precheck + outbox worker for async debit
  cacherules/            Priority-sorted glob matching
  policy/                Regex deny/allow rule matcher
  customertracebridge/   Per-tenant OTLP span export
  gatewaytracer/         Gateway-side OTel instrumentation
```

## Base URL

`http://localhost:5563/`

## HTTP transport

### Endpoints

All `/v1/*` endpoints require a `Bearer` token (virtual key). The gateway
resolves the token into a `Bundle` containing provider credentials, budget
limits, rate limits, guardrails, policy rules, and model aliases.

#### `POST /v1/chat/completions`

OpenAI-compatible chat completion. Supports `stream: true` for SSE.

#### `POST /v1/messages`

Anthropic-compatible messages endpoint. Supports `stream: true` for SSE.

#### `POST /v1/embeddings`

OpenAI-compatible embedding generation.

#### `GET /v1/models`

Lists available models for the authenticated virtual key.

### Health

| Endpoint     | Purpose                                        |
|--------------|------------------------------------------------|
| `/healthz`   | Liveness probe (always 200)                   |
| `/readyz`    | Readiness probe (503 until auth cache warms)  |
| `/startupz`  | Startup probe                                 |

### Response headers

Every proxied response includes:

- `X-LangWatch-Gateway-Version` — build version of the running gateway.
- `X-LangWatch-Gateway-Request-Id` — gateway-minted ID for debit idempotency.
- `X-LangWatch-Budget-Warning` — present when budget thresholds are breached.
- `X-LangWatch-Fallback-Count` — number of provider fallbacks attempted.
- `X-LangWatch-Cache-Mode` — cache override decision (`respect`, `disable`, or `force`).

## Request pipeline

Each request passes through an interceptor chain:

```
Auth → RateLimit → Policy → Resolve → Cache → Budget → Guardrail → Dispatch → Trace
```

All interceptors are defined as port interfaces in `app/ports.go`.

## Running locally

```bash
make service svc=aigateway       # run once
make service-watch svc=aigateway # live reload via air
```

This sources `langwatch/.env` in full — Go and the TS control-plane
share the same file, so secrets like `LW_GATEWAY_INTERNAL_SECRET` live in
exactly one place. Vars the Go service doesn't need are ignored by
`config.Hydrate`. Required: `LW_GATEWAY_INTERNAL_SECRET`,
`LW_GATEWAY_JWT_SECRET`, `LW_GATEWAY_BASE_URL` (see
`langwatch/.env.example`).

Logs emit as pretty-printed JSON locally (`LOG_FORMAT=pretty` is set by the
Makefile target).

## Configuration

All config is loaded from environment variables via `pkg/config.Hydrate` (nested
struct tags chain with `_`). See `config.go` for the source of truth.

| Variable                         | Required | Default               | Description                        |
|----------------------------------|----------|-----------------------|------------------------------------|
| `ENVIRONMENT`                    | yes      |                       | e.g. `local`, `production`         |
| `SERVER_ADDR`                    | no       | `:5563`               | Listen address                     |
| `SERVER_GRACEFUL_SECONDS`        | no       | `10`                  | Shutdown grace period (seconds)    |
| `LOG_LEVEL`                      | no       | `info`                | Log level                          |
| `LOG_FORMAT`                     | no       | `json`                | `json` or `pretty`                 |
| `LW_GATEWAY_BASE_URL`           | yes      | `http://localhost:5560` | Control plane URL                 |
| `LW_GATEWAY_INTERNAL_SECRET`    | yes      |                       | HMAC shared secret                 |
| `LW_GATEWAY_JWT_SECRET`         | yes      |                       | JWT verification secret            |
| `LW_GATEWAY_JWT_SECRET_PREVIOUS`| no       |                       | Previous JWT secret (rotation)     |
| `OTEL_GATEWAY_ENDPOINT`         | no       |                       | OTel collector for gateway traces  |
| `OTEL_GATEWAY_AUTH_TOKEN`       | no       |                       | Bearer token for OTel collector    |
| `OTEL_DEFAULT_EXPORT_ENDPOINT`  | no       |                       | Default customer OTLP endpoint     |
| `OTEL_DEFAULT_AUTH_TOKEN`       | no       |                       | Bearer token for default endpoint  |

## Testing

```bash
go test -race -count=1 ./services/aigateway/...
```
