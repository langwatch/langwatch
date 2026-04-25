# nlpgo provider matrix — end-to-end live tests

Verifies every supported LLM provider × call shape works through the new
Go LLM executor (`services/nlpgo/adapters/llmexecutor`), with credentials
inlined per request (NOT via Virtual Keys — the Studio path doesn't have
VKs; it has stored ModelProvider credentials per project).

This is the parallel of `services/aigateway/tests/matrix/` for the
nlp-go side. The aigateway matrix verifies the public VK path; this
matrix verifies the nlpgo→gateway internal-inline-credentials path.

## Pre-requisites

A live gateway must be running (`make service svc=aigateway`) on
`http://localhost:5563`, with the same `LW_GATEWAY_INTERNAL_SECRET` set
both in the gateway's env and in the test runner's env.

Each test reads provider keys from env vars — missing env = `t.Skip`,
never fails. The same env file `langwatch/.env` works for all of them.

## Running one provider

```bash
GATEWAY_URL=http://localhost:5563 \
LW_GATEWAY_INTERNAL_SECRET=<hex> \
OPENAI_API_KEY=sk-... \
OPENAI_MODEL=gpt-5-mini \
  go test -tags=live_openai -run TestOpenAI ./services/nlpgo/tests/matrix/... -v
```

## Running the full matrix

```bash
go test -tags='live_openai live_anthropic live_gemini live_bedrock live_azure live_vertex' \
  ./services/nlpgo/tests/matrix/... -v
```

## What each test verifies

For every provider:

1. **Translator shape** — the litellm_params dict the TS app would build for
   this provider gets translated into the inline-credentials JSON the
   gateway accepts.
2. **HMAC sig** — nlpgo signs the request with `LW_GATEWAY_INTERNAL_SECRET`
   in the canonical layout the gateway's `InternalAuthMiddleware` verifies.
3. **Round-trip** — gateway resolves a synthetic Bundle from inline creds,
   dispatches via Bifrost to the real provider, returns a 200 with content
   and usage.
4. **Reasoning-model rules** (where applicable) — temperature pinned to
   1.0 and max_tokens floored at 16000 are observable on the gateway side.
5. **Anthropic temperature clamp** — temperature > 1 is clamped to 1
   before dispatch.
6. **Origin header** — `X-LangWatch-Origin: workflow` is forwarded to the
   gateway and lands as a span attribute.

## Why no cost-on-trace verification yet

The aigateway matrix tests poll `/api/trace/<id>` to verify cost
attribution. nlpgo studio runs use a different trace pile (the project's
own LangWatch trace), and the verification requires the project's API
key separately. We add the trace-poll verification in a follow-up — for
v1 we assert response shape + token usage at the response level.
