# Provider matrix — end-to-end live tests

Verifies every supported LLM provider × call shape works through the gateway, with tokens + cost captured on the LangWatch platform.

Addresses iter 110 rchaves priority #2: "a matrix of tests to be sure it works with all providers, with all situations: openai, anthropic, gemini, bedrock, azure and vertex, in all: simple completion, streamed completion (tokens and cost counting correctly), tool calling, structured outputs".

## Pre-requisites

The tests require a live stack:

- **Gateway** running on `http://localhost:5563` (`make service svc=aigateway`)
- **Control plane** running on `http://localhost:5560` (`make dev` + `pnpm dev`)
- **A virtual key** with the provider you want to test bound as a credential
- **LangWatch project API key** (for post-request trace verification)

Each test reads these from env vars — missing env = `t.Skip`, never fails.

## Running one cell

```bash
# openai — simple completion
GATEWAY_URL=http://localhost:5563 \
LW_VK=lw_vk_live_... \
LW_PROJECT_API_KEY=sk-lw-... \
OPENAI_MODEL=gpt-5-mini \
  go test -tags=live_openai -run TestOpenAI_SimpleCompletion ./services/aigateway/tests/matrix/... -v
```

## Running the full provider matrix

```bash
# Requires every env var for every provider — see per-cell docs
go test -tags='live_openai live_anthropic live_gemini live_bedrock live_azure live_vertex' \
  ./services/aigateway/tests/matrix/... -v
```

## Cost verification pattern

Each test:

1. Fires a request through the gateway → gets `X-LangWatch-Trace-Id` response header.
2. Waits up to 10s for the trace to land in the ingest pipeline.
3. `GET /api/trace/{traceId}` with project API key → asserts `metrics.total_cost > 0` and `metrics.total_tokens > 0`.

This verifies the full `gateway → OTLP → ingest → cost-calc` chain, not just that the provider returned a response.

## Cell inventory

Each cell is a single `t.Run` in `provider_matrix_test.go`. Build-tagged per provider so CI's default `go test ./...` never spends real credits.

| Provider | Simple | Streamed | Tool calling | Structured outputs | Build tag |
|----------|:------:|:--------:|:------------:|:------------------:|-----------|
| openai    | 🚧 | 🚧 | 🚧 | 🚧 | `live_openai` |
| anthropic | 🚧 | 🚧 | 🚧 | 🚧 | `live_anthropic` |
| gemini    | 🚧 | 🚧 | 🚧 | 🚧 | `live_gemini` |
| bedrock   | 🚧 | 🚧 | 🚧 | 🚧 | `live_bedrock` |
| azure     | 🚧 | 🚧 | 🚧 | 🚧 | `live_azure` |
| vertex    | 🚧 | 🚧 | 🚧 | 🚧 | `live_vertex` |

24 cells total. As each lands green, flag ✅ with duration + captured cost in `.claude/AI-GATEWAY-TEST-MATRIX.md`.

## Model defaults (cheapest that supports all 4 shapes)

| Provider | Default model | Env override |
|----------|---------------|--------------|
| openai    | `gpt-5-mini` | `OPENAI_MODEL` |
| anthropic | `claude-haiku-4-5-20251001` | `ANTHROPIC_MODEL` |
| gemini    | `gemini-2.5-flash` | `GEMINI_MODEL` |
| bedrock   | `anthropic.claude-3-5-haiku-20241022-v1:0` | `BEDROCK_MODEL` |
| azure     | `gpt-5-mini` (via the `langwatchopenaisweden` deployment) | `AZURE_MODEL` |
| vertex    | `gemini-2.5-flash` (us-central1) | `VERTEX_MODEL` |
