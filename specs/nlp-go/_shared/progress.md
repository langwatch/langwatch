# NLP→Go migration — north star + progress

> Loop-stable progress doc. Every iteration of the Ralph Loop reads this on startup
> and updates it before exit. Survives across sessions where /tmp/ does not.

## ⚠️ OPEN DECISION (raised by @rchaves, awaiting confirmation)

**Question:** should `nlpgo → AI Gateway` be a library import or an HTTP call?

The current spec/contract assumes HTTP-with-HMAC-and-inline-credentials. rchaves
challenged this on three grounds:
1. Lambda is in an isolated VPC with no path back to the cluster — the gateway
   would have to be reached over a public hop, which is silly.
2. He doesn't want a fourth server in the deployment topology.
3. With library mode, the inbound-HMAC + inline-credentials extension on the
   gateway disappears entirely.

**Proposed pivot (ash, 2026-04-25):** flip to library. Reasons:
- The "untrusted user code shares memory with provider keys" concern was wrong —
  per contract.md §7 the code block runs as a Python *subprocess* (stdin/stdout,
  no network), so the Go process is a clean key boundary.
- nlpgo imports `services/aigateway/dispatcher` (a new in-process surface that
  exposes the provider router with a BYO-credentials entry-point); skips VK
  resolution, rate-limit, budget, guardrail evaluation by default — those are
  control-plane-state checks irrelevant to studio runs.
- nlpgo still talks **directly** to providers (OpenAI, Anthropic, Bedrock,
  Vertex) over Lambda's existing 443-anywhere egress. No public gateway hop.
- HTTP gateway service stays for direct VK customers — unchanged.

**Provider quirks belong in the gateway, not in nlpgo:** model-id dot→dash,
Anthropic alias expansion, Anthropic temperature clamp `[0,1]`, reasoning model
overrides (o1/o3/gpt-5 → temp=1.0, max_tokens floor) — all should live in the
gateway's per-provider adapters so direct VK customers benefit too. nlpgo's
"litellm translator" shrinks to: read DSL → build clean ProviderRequest → hand
to library. The DSL-side `reasoning_effort/thinkingLevel/effort` aliasing stays
in nlpgo (Studio UI concern, not gateway concern).

**Open: TS → nlpgo HMAC.** rchaves implied the internal secret could "go away
completely". Today's Python NLP path has no auth (Function URL + URL secrecy).
Adding HMAC only on `/go/*` is asymmetric. Two options:
- Drop the HMAC entirely; match today's no-auth posture for nlpgo.
- Keep HMAC for `/go/*` only as defense in depth (current spec/code).
Awaiting rchaves's confirmation before ripping out `LW_NLPGO_INTERNAL_SECRET`.

**What lands once confirmed:**
- contract.md §8/§9 rewrite (gateway = library; provider quirks at gateway).
- llm-block.feature + proxy.feature scenarios drop inline-creds header steps.
- specs/ai-gateway/provider-quirks.feature added (model-id, temp clamps,
  reasoning overrides as gateway-level guarantees).
- services/nlpgo/adapters/gatewayclient/ → renamed to gatewaycall, becomes a
  thin shim over an imported `services/aigateway/dispatcher` package.
- The proposed gateway "inline-credentials inbound" middleware never gets built.
- If rchaves confirms drop-HMAC: TS sign.ts, nlpgo httpapi/middleware.go HMAC,
  middleware_test.go all roll back.

**Status (2026-04-25, end of multi-iteration session):**

Architectural pivots that landed (per rchaves's loop guidance):
- **library not HTTP** for nlpgo→aigateway (Lambda VPC isolation forces it)
- **drop LW_NLPGO_INTERNAL_SECRET** + all HMAC bridges (matches today's
  no-auth Python posture; library mode obviates the need)
- **provider quirks STAY in nlpgo** as temporary parity hacks (rchaves's
  "fail naturally" was aspirational; prime directive "customers with crazy
  existing workflows must keep working" wins)
- **dot→dash fixed at source** in the langwatch-saas openrouter ingest
  (Anthropic-only — other providers' dotted ids accepted as-is)
- **topic clustering moves to langevals** (Python+sklearn+LiteLLM stays
  intact; only hosting service changes; long-term goal: all Python in one
  place, langwatch_nlp deletable)

Commits on `feat/nlp-go-migration`:
- ✅ `27238ce28` server-side optimize 410 guard (UI hide already wired)
- ✅ `0954724bd` evaluation runs tagged origin=evaluation (was misattributed)
- ✅ `fea1e5151` (sarah) drop HMAC bridge end-to-end + revert topic-naming gateway path
- ✅ `7fa461e7d` (sarah) services/aigateway/dispatcher/ in-process Dispatch + tests
- ✅ `c9e3b7243` (sarah) SSE round-trip tests for proxypass
- ✅ `195e9f888` topic_clustering as a langevals workspace member (1476 LOC)
- ✅ `922de1ec6` TS topic-clustering flag-fork to langevals when flag on

External PR:
- ✅ langwatch-saas#459 — fix(model-registry): normalize Anthropic version
  dots at ingest. https://github.com/langwatch/langwatch-saas/pull/459

In progress / queued:
- ⏳ sarah — C consumer swap: replace nlpgo's HTTP gatewayclient with a
  thin adapter over the new dispatcher pkg (~20min ETA at last check)
- ⏳ ash — port topic_clustering tests from langwatch_nlp/tests/ to
  langevals/evaluators/topic_clustering/tests
- ⏳ ash — sister PR on langwatch-saas/infrastructure (memory tier 3072MB
  for topic_clustering Lambda + run the lambda generator)
- ⏳ next iteration — end-to-end QA: dogfood a real workflow run on the
  Go path through a flagged project, then a real topic clustering run via
  langevals, then push the PR for CodeRabbit review

Open questions for next iteration:
- Is dispatcher.Dispatcher's interface stable now that sarah's adapter swap
  is landing? need to verify the matrix tests still pass after the swap
- LANGEVALS_ENDPOINT env in production points where today? Need to confirm
  langevals API Gateway base URL is what TS app reads (it is, via
  evaluationsWorker.ts:652 pattern), but topic_clustering paths /topics/*
  need to be added to langevals_api_gateway.tf path-routing

The PR is *not* ready to ship until:
- All tests green (Go matrix + ts unit + langevals package)
- A live QA run end-to-end through a flag-on project
- Screenshots in the PR description (per orchestrate skill)
- CodeRabbit review addressed

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
- [x] DSL parser + Go structs (sarah)
- [x] Engine: topo sort + node executor (sarah) — orchestrator with planner-driven layered execution + per-layer goroutine fan-out
- [x] Dataset block (sarah) — column-oriented materialization, deterministic split
- [x] HTTP block (sarah) — Liquid templates, JSONPath, SSRF protection, all 5 methods + 3 auth schemes
- [x] Code block via `runner.py` subprocess (sarah) — Python sandbox, structured errors, timeouts, isolation
- [x] **Gateway inline-creds inbound auth path** in `services/aigateway/` (ash) — 13 unit tests
- [x] `litellm_params` translator (ash) — 24 unit tests across 7 providers
- [x] Gateway client (HTTP, HMAC, streaming) (ash) — 7 unit tests with httptest server
- [x] LLM block (ash, depends on engine ports + gateway client) — `llmexecutor` adapter, 14 unit tests

### Phase 2 — TS app integration
- [x] Feature flag `release_nlp_go_engine_enabled` wired in `runWorkflow.ts` (ash, via `nlpgoFetch`)
- [ ] Same wiring for `playground.ts` (Vercel AI SDK custom-fetch — follow-up)
- [x] HMAC signing with `LW_NLPGO_INTERNAL_SECRET` (ash) — body-only canonical, hardening to METHOD\nPATH\nTS\nBODYHASH = follow-up
- [x] Optimize button hidden when flag is on (ash) — `workflow.engineMode` tRPC query + UI guard
- [ ] Optimize endpoint 410 / websocket guard (server-side enforcement, follow-up)
- [x] Telemetry origin header set in runWorkflow (ash) — propagated through translator → gateway

### Phase 3 — deployment
- [x] `Dockerfile.langwatch_nlp.lambda` bundles Go binary + entry script (ash) — Go build stage in multi-stage; entrypoint at `langwatch_nlp/scripts/entrypoint.sh`
- [x] `NLPGO_BYPASS=1` honored in entry script (ash)
- [ ] Helm chart updates if needed (ash) — likely no changes since same container; verify
- [ ] Dev `Dockerfile.langwatch_nlp` mirror update (ash, follow-up)
- [ ] Terraform: no memory bump expected; verify (ash)

### Phase 4 — tests + QA
- [x] Provider matrix tests `tests/matrix/` with build tags (ash) — 6 providers (openai, anthropic, azure, bedrock, vertex, gemini), `live_*` build tags, README, env-var skip pattern
- [x] Engine integration tests with real HTTP gateway stub (sarah) — 8 e2e tests through full chi router via httptest, including signature node end-to-end against stub gateway and edge handle rename test
- [ ] Topic clustering swap LiteLLM → gateway HTTP (ash, in progress)
- [x] PR opened + CI green — PR #3483 (https://github.com/langwatch/langwatch/pull/3483) draft against feat/ai-gateway
- [ ] CodeRabbit review addressed (drive-pr loop active)
- [ ] Browser QA: real workflows in Studio across providers
- [ ] Screenshots embedded in PR via img402.dev

### Status snapshot per iteration
- 2026-04-25 iter1: scaffolding + DSL + planner + dataset/code/HTTP blocks + engine orchestrator + handler wiring + 7 integration tests (sarah). gateway inline-creds + gatewayclient + litellm translator + llmexecutor (ash). PR #3483 opened draft. 143/143 nlpgo tests + 13 new aigateway tests green.
- 2026-04-25 iter1 cont: TS app `nlpgoFetch` + `runWorkflow.ts` switch + Optimize button hide (ash). Provider matrix tests (ash). Lambda Dockerfile bundles Go binary with NLPGO_BYPASS entrypoint (ash). 8 e2e tests (sarah added edge-handle-rename). CI lint fix on internal_auth.go (sarah).

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
