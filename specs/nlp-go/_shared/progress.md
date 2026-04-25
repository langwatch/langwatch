# NLP→Go migration — north star + progress

> Loop-stable progress doc. Every iteration of the Ralph Loop reads this on startup
> and updates it before exit. Survives across sessions where /tmp/ does not.

## Goal

Replace the Python `langwatch_nlp` workflow execution engine with a Go service
(`services/nlpgo/`) that produces byte-equivalent results across every supported
workflow shape, while running side-by-side with the Python service in the same
container/lambda. Kill DSPy and LiteLLM from the studio + playground paths; keep
topic clustering on Python. Roll out per-project via feature flag.

## Hard requirements

1. **Parallel deployment, single container.** Go binary is the entry on `:5562`,
   reverse-proxies non-`/go/*` to `uvicorn:5561`. `NLPGO_BYPASS=1` makes uvicorn
   the entry directly. See `_shared/contract.md` §3.
2. **No DSPy, no LiteLLM** in the Go path. Direct HTTP calls to the LangWatch AI
   Gateway. Inline credentials per-request (gateway needs the inbound auth path —
   tracked below).
3. **Provider parity.** OpenAI, Anthropic, Gemini AI Studio, Azure OpenAI (incl.
   Azure API Gateway proxy mode), AWS Bedrock (incl. STS managed chain), Vertex
   AI (incl. inline SA JSON), and custom OpenAI-compatible providers (Together,
   Mistral, Groq, etc.) must all produce identical workflow outputs to the
   Python+LiteLLM path.
4. **Reasoning model rules preserved.** `^(o1|o3|o4|o5|gpt-5)*` force
   `temperature=1.0` and `max_tokens >= 16000`. Anthropic temperature clamps to
   `[0,1]`. `reasoning|reasoning_effort|thinkingLevel|effort` collapse to one
   key. Anthropic model id dot→dash.
5. **Multi-turn chat preservation.** `chat_messages` flow across nodes with full
   role/content/tool_calls history; no collapsing. Tool-call args are canonical
   JSON.
6. **Streaming.** SSE pass-through with no buffering, idle timeouts, heartbeats,
   and client-cancellation propagation.
7. **Telemetry with correct origin.** Every span tagged with `langwatch.origin ∈
   {workflow, evaluation, playground, topic_clustering}`. Origin is set at the
   request boundary and propagates to every child span (engine, block, gateway
   call, code-sandbox subprocess). See `telemetry.feature`.
8. **Optimization is dead.** When `release_nlp_go_engine_enabled` is on for a
   project, the Studio Optimize button is hidden, and the optimization endpoint
   returns `410 Gone` with a friendly explanation. No DSPy, no optimization.
   See `feature-flag.feature`.
9. **Tests, real ones.** Provider matrix tests with `//go:build live_<provider>`
   tags vs real keys in `langwatch/.env`. Engine integration tests exercise the
   engine end-to-end with a real HTTP gateway stub.

## Out of scope (this PR)

- Topic clustering rewrite. Stays Python+sklearn. Internal LiteLLM calls inside
  topic clustering get swapped for thin gateway HTTP calls; the public surface
  doesn't move.
- Backwards-incompatible Studio JSON DSL changes.
- Deletion of Python NLP code. Removal is a follow-up after the flag is at 100%
  for two release cycles.
- Lambda memory bump (current 1024MB sufficient).

## Architecture at a glance

```
┌────────────────────────── one container ────────────────────────────┐
│ Lambda Web Adapter / pod ingress  →  127.0.0.1:5562                  │
│                                                                       │
│  nlpgo (Go, entrypoint, :5562)                                       │
│   /go/studio/execute_sync   handler  ─→ engine ─→ gatewayclient ──┐  │
│   /go/studio/execute        SSE handler                            │  │
│   /go/proxy/v1/*            passthrough ────→ aigateway:5563   ◀──┘  │
│   /go/topics/*              404 (kept on Python intentionally)        │
│   /healthz                  nlpgo + child status                      │
│   /readyz                   blocks until child healthy                │
│   any other path            reverse-proxy ──→ uvicorn (child)         │
│                                                                       │
│  uvicorn (Python langwatch_nlp, child of nlpgo, :5561)                │
│   /studio/*  /proxy/v1/*  /topics/*    legacy handlers stay           │
└──────────────────────────────────────────────────────────────────────┘
```

`NLPGO_BYPASS=1` ⇒ entry script binds uvicorn on `:5562` directly; nlpgo absent.

## Auth model

| Hop                       | Mechanism                                          |
|---------------------------|----------------------------------------------------|
| TS app → nlpgo `/go/*`    | HMAC over canonical request, `LW_NLPGO_INTERNAL_SECRET` |
| TS app → uvicorn (legacy) | unsigned (today's behavior, retrofit out of scope) |
| nlpgo → AI Gateway        | HMAC + inline-credentials header, `LW_GATEWAY_INTERNAL_SECRET` |
| AI Gateway public surface | unchanged: VK / Bearer (or x-api-key, x-goog-api-key) |

## Status checklist

> Update on each iteration.

### Phase 0 — alignment + scaffolding
- [x] Findings docs (ash + sarah) — `/tmp/nlp-go-migration/` and committed via specs
- [x] `_shared/contract.md` — wire-level decisions (sarah)
- [x] `_shared/progress.md` — this doc (ash)
- [x] `engine.feature`, `dataset-block.feature`, `code-block.feature`, `http-block.feature` (sarah)
- [x] `llm-block.feature`, `proxy.feature`, `feature-flag.feature`, `parallel-deployment.feature`, `front-door.feature` (ash)
- [x] `telemetry.feature` (ash)
- [x] `services/nlpgo/` scaffold (sarah) — chi router, HMAC auth, uvicorn child manager, reverse-proxy fall-through, healthz aggregating child, `cmd/service/main.go` registers nlpgo subcommand
- [x] `services/nlpgo/app/ports.go` interfaces (sarah) — `GatewayClient`, `LLMClient`, `LLMRequest`/`LLMResponse`, `ChatMessage`, `Tool`, `CodeRunner`, `CodeRequest`/`CodeResult`, `ChildHealth`, `ChildProxy`, `ChildManager`, `SecretsResolver`. Translator maps Provider/Model + Origin + reasoning_effort. `go build ./services/nlpgo/... ./cmd/service/...` clean.

### Phase 1 — engine + gateway client
- [ ] DSL parser + Go structs (sarah)
- [ ] Engine: topo sort + node executor (sarah)
- [ ] Dataset block (sarah)
- [ ] HTTP block (sarah)
- [ ] Code block via `runner.py` subprocess (sarah)
- [ ] **Gateway inline-creds inbound auth path** in `services/aigateway/` (ash)
- [ ] `litellm_params` translator (ash)
- [ ] Gateway client (HTTP, HMAC, streaming) (ash)
- [ ] LLM block (ash, depends on engine ports + gateway client)

### Phase 2 — TS app integration
- [ ] Feature flag `release_nlp_go_engine_enabled` wired in `runWorkflow.ts` + `playground.ts` (ash)
- [ ] HMAC signing with `LW_NLPGO_INTERNAL_SECRET` (ash)
- [ ] Optimize button hidden + 410 endpoint when flag on (ash)
- [ ] Telemetry origin headers set per call site (ash)

### Phase 3 — deployment
- [ ] `Dockerfile.langwatch_nlp.lambda` bundles Go binary + entry script (sarah/ash)
- [ ] `NLPGO_BYPASS=1` honored in entry script (ash)
- [ ] Helm chart updates if needed (ash)
- [ ] Terraform: no memory bump expected; verify (ash)

### Phase 4 — tests + QA
- [ ] Provider matrix tests `tests/matrix/` with build tags (ash)
- [ ] Engine integration tests with real HTTP gateway stub (sarah)
- [ ] Topic clustering swap LiteLLM → gateway HTTP (ash, scoped down)
- [ ] PR opened + CI green
- [ ] CodeRabbit review addressed
- [ ] Browser QA: real workflows in Studio across providers
- [ ] Screenshots embedded in PR via img402.dev

## Open questions / risks
- Gateway inline-creds auth path is a precondition for everything in the Go
  studio path. If that lands stuck, the whole thing stalls. **Land first.**
- DSPy `prompting_technique` → only `ChainOfThought` is in v1 scope. Pull
  prod telemetry to confirm no other techniques are in use (handled at
  TS-app feature-flag fall-back: workflow with unsupported technique → Python).
- Lambda Web Adapter against a Go upstream — not yet verified live, must test
  before claiming `RESPONSE_STREAM` works end-to-end.
- Code-sandbox subprocess from Go — Lambda has 512MB ephemeral storage and
  shared mount; verify Python interpreter is in the image and PATH.
- Cost attribution: gateway needs `X-LangWatch-Project-Id` from nlpgo on every
  call so traces land on the right project trace pile.
