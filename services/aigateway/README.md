# svc_aigateway

## Description

AI Gateway is the data-plane proxy that sits between customers and LLM
providers. It resolves virtual keys into provider credentials, enforces budgets,
rate limits, guardrails, and policy rules, then dispatches requests via Bifrost.
Per-tenant OTLP traces are emitted for every completion.

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

| Endpoint     | Purpose                         |
|--------------|---------------------------------|
| `/healthz`   | Liveness probe (always 200)     |
| `/readyz`    | Readiness probe (503 if draining) |
| `/startupz`  | Startup probe                   |

### Response headers

Every proxied response includes:

- `X-LangWatch-Gateway-Version` — build version of the running gateway.
- `X-LangWatch-Gateway-Request-Id` — gateway-minted ID for debit idempotency.
- `X-LangWatch-Budget-Warning` — present when budget thresholds are breached.
- `X-LangWatch-Fallback-Count` — number of provider fallbacks attempted.
- `X-LangWatch-Cache-Mode` — cache override decision (`respect` or `disable`).

## Request pipeline

Each request passes through an interceptor chain:

```
Auth -> RateLimit -> Policy -> Resolve -> Cache -> Budget -> Guardrail -> Dispatch -> Trace
```

All interceptors are defined as port interfaces in `app/ports.go`.

## Running locally

```bash
make service svc=aigateway
```

This sources `langwatch/.env` for shared secrets and starts the gateway with
`GATEWAY_ALLOW_INSECURE=1` for local development. Requires `langwatch/.env`
with `LW_GATEWAY_INTERNAL_SECRET`, `LW_GATEWAY_JWT_SECRET`, and
`LW_VIRTUAL_KEY_PEPPER` set (see `langwatch/.env.example`).

## Configuration

All config is loaded from environment variables (see `config.go`):

| Variable                              | Required | Default  | Description                          |
|---------------------------------------|----------|----------|--------------------------------------|
| `ENVIRONMENT`                         | yes      |          | e.g. `development`, `production`     |
| `GATEWAY_ADDR`                        | no       | `:5563`  | Listen address                       |
| `GATEWAY_GRACEFUL_SECONDS`            | no       | `10`     | Shutdown grace period                |
| `GATEWAY_CONTROL_PLANE_BASE_URL`      | yes      |          | Control plane URL                    |
| `GATEWAY_CONTROL_PLANE_INTERNAL_SECRET` | yes    |          | HMAC shared secret                   |
| `GATEWAY_CONTROL_PLANE_JWT_SECRET`    | yes      |          | JWT signing secret                   |
| `GATEWAY_LOG_LEVEL`                   | no       | `info`   | Log level                            |

## Testing

```bash
go test -race -count=1 ./services/aigateway/...
```
