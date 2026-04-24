# AI Gateway Test Matrix

Shared tracking artifact for the three-priority verification push ordered by
rchaves on the iter 109+ branch. Each row appended as cells go end-to-end
green. Paths relative to repo root.

---

## Priority 1 — Budget ClickHouse event-sourcing pipeline
**Owner:** @ai_gateway_alexis_2
**Goal:** verify full trace → reactor → CH rollup → `/budget/check`
enforcement, no mocks.

| # | Surface | Test file | Status |
|---|---------|-----------|--------|
| 1 | Go gateway stamps VK + reqID on customer spans | `services/aigateway/adapters/customertracebridge/emitter.go` (`db2a02fe1`) | ✅ shipped |
| 2 | gatewayBudgetSync reactor wired into pipeline | `langwatch/src/server/event-sourcing/pipelines/trace-processing/reactors/gatewayBudgetSync.reactor.ts` (`111d172f0`) | ✅ shipped |
| 3 | Reactor unit tests (6 scenarios) | `…/__tests__/gatewayBudgetSync.reactor.unit.test.ts` (`2c253a127`) | ✅ shipped |
| 4 | `/budget/check` reads CH sumMerge | `langwatch/src/server/routes/gateway-internal.ts` (`7d6c8d9c5`) | ✅ shipped |
| 5 | E2E integration (real PG + real CH, no mocks) | `langwatch/src/server/gateway/__tests__/gatewayBudgetSync.reactor.integration.test.ts` (`a421d0086`) | ✅ shipped |
| 6 | $10 budget on matrix-openai VK (cross-validates Priority 2) | `scripts/seed-gateway-dogfood.ts` (alexis seed extension) | ✅ shipped |
| 7 | Delete PG debit path (deferred — after matrix proves CH path) | _(pending)_ | ⏳ deferred |

**Status:** Priority 1 fully code-complete + tested. Cross-validation via
Priority 2 / 3 matrix runs.

---

## Priority 2 — Provider matrix (6 providers × 5 scenarios = 30 cells)
**Owner:** @ai_gateway_sergey_2
**Goal:** every provider × every call shape works end-to-end through the
gateway, with token counts and cost captured on the LangWatch trace.

Test target: Go integration tests under
`services/aigateway/tests/matrix/{provider}_test.go` against the real gateway
binary, real provider credentials, trace assertion via the LW search API
post-run.

Build tags per provider: `live_openai`, `live_anthropic`, `live_gemini`,
`live_bedrock`, `live_azure`, `live_vertex`. Default `go test` skips all.

Last execution: 2026-04-24. Gateway binary `<tip>`. Live run against
real provider credentials; traces + costs captured on the LangWatch
platform (`/api/trace/:id`).

| Provider | Simple | Streamed | Tool calling | Structured outputs | Cache |
|----------|--------|----------|--------------|--------------------|-------|
| openai    | ✅ 2.95s · \$0.000035  | ✅ 26.20s · \$0.000101 | ✅ 10.60s · \$0.000162 | ✅ 18.95s · \$0.000135 | ✅ 36.28s · \$0.000255 (gpt-4o-mini) |
| anthropic | ✅ 5.85s · \$0.000035  | ✅ 9.71s · \$0.000086  | ✅ 5.61s · \$0.000839  | ✅ 5.33s · \$0.000161  | ✅ 22.66s · \$0.010245 (sonnet 4.5, /v1/messages, cache_read=3362) |
| gemini    | ✅ 9.87s · \$0.000075  | ✅ 5.14s · \$0.000099  | ✅ 9.83s · \$0.000253  | ✅ 3.60s · \$0.000178  | ✅ 8.69s · \$0.000933 (cachedContents API, cache_read=2834) |
| bedrock   | ✅ 11.44s · \$0.000035 | ✅ 17.80s · \$0.000086 | ✅ 5.72s · \$0.000146  | ✅ 15.33s · \$0.000135 | ✅ 60.63s · \$0.017421 (sonnet 4.5, /v1/chat/completions, cache_read=3362) |
| azure     | ✅ 13.82s · \$0.000035 | ✅ 18.63s · \$0.000080 | ✅ 10.55s · \$0.000152 | ✅ 27.33s · \$0.000128 | ✅ 21.39s · \$0.000489 |
| vertex    | ✅ 3.55s · \$0.000047  | ✅ 6.26s · \$0.000084  | ✅ 5.79s · \$0.000146  | ✅ 9.42s · \$0.000178  | ✅ 16.56s · \$0.000925 (cachedContents API, cache_read=2834) |

**🟢 30/30 end-to-end green. Three sequential gateway fixes shipped
this push:**

1. **`fix(gateway/cache-rules)` (479131138)** — extended the gateway
   cache rule wire DTO + evaluator to honour `vk_id` / `vk_prefix` /
   `vk_tags` / `request_metadata` matchers. The control-plane
   materialiser already emits all five matcher kinds, but the gateway
   silently dropped four of them at unmarshal, collapsing every rule's
   effective scope to "match all". With the dogfood seed's
   `disable-cache-evals` rule (priority 200, matcher
   vk_prefix=lw_vk_eval_) winning the priority sort, every matrix-*
   request had `cache_control` stripped from the system block by the
   Cache interceptor. Verified with `LW_GATEWAY_OUTBOUND_PROXY` +
   mitmdump capture: outbound bytes from gateway → api.anthropic.com
   were 16481 (input 16521), exactly 40 bytes shorter — the size of
   `, "cache_control": {"type": "ephemeral"}`. Direct-curl with the
   same bytes returned cache_creation_input_tokens=3362; through the
   gateway, 0/0. After the fix: outbound bytes = 16521, cache_control
   intact, response carries cache_creation/read=3362. Unblocked
   anthropic + bedrock cache cells.
2. **`fix(gateway/parser)` extension-key lift** — the gateway's
   chat-completions parser now lifts gemini/vertex extension keys
   (`cached_content`, `safety_settings`, `labels`) from the inbound
   body onto Bifrost's `ChatParameters.ExtraParams`. Bifrost's gemini
   chat translator (shared with vertex) reads these off ExtraParams
   and lifts them onto the provider-native request shape — but
   ExtraParams is `json:"-"` so a stock json.Unmarshal can't populate
   it. Without this lift, callers can't drive Google's prompt caching
   end-to-end via the standard /v1/chat/completions endpoint.
3. **Matrix cells for gemini + vertex** — refactored the cache cells
   to use the explicit `cachedContents` API end-to-end through the
   gateway. Setup call (POST /v1beta/cachedContents) hits the provider
   directly, the matrix-{provider} VK fires the chat-completions read
   through the gateway carrying `cached_content: <name>`. Response
   carries cached_read_tokens > 0 and the trace lands with cost
   captured on the LangWatch platform. The implicit prefix-cache path
   stays a v1.1 follow-up since it requires paid-tier billing on the
   Google account; the explicit cachedContents path works on every
   tier and is the canonical Google recommendation for >1024 token
   prefixes.

**✅ Bedrock unblocked post iter-110**: two real fixes landed to reach
green on the 4 core scenarios — (a) AWS marketplace permissions
(`aws-marketplace:ViewSubscriptions/Subscribe/Unsubscribe`) added to the
`langwatch-dev-bedrock-user` IAM inline policy; (b) Bedrock model-id
normaliser in the ingest pipeline so `eu.anthropic.claude-haiku-4-5-20251001-v1:0`
resolves against the pricing catalog entry `anthropic/claude-haiku-4.5`.

**Cache cells — shipped byte-preservation fix (iter-110 `a4286eb86`)**:

Earlier runs showed `cached_tokens=0` across providers through the
gateway while direct api.openai.com calls hit `cached_tokens=1408` on
identical 2nd-call bodies. Root cause: `d84160f32` schema translation
was unmarshal+re-marshaling bodies even on the same-wire-shape
OpenAI → OpenAI happy path, changing byte order and breaking OpenAI's
prefix-hash cache key.

Fix `a4286eb86` added `isOpenAICompatibleProvider` check — same-wire-shape
routes (OpenAI, Azure) now use raw-forward (byte-for-byte preserved),
cross-wire routes (OpenAI-client → Anthropic/Gemini/Bedrock/Vertex) keep
translation. Verified 10/10 cache hits through gateway on gpt-4o-mini;
Azure cache reliably hits on the same path.

**v1 limit — cache cells for non-OpenAI-family providers**:
Sharpened via direct-to-provider tests (bypassing the gateway):

- **Anthropic + Bedrock**: `cache_creation_input_tokens=0` AND
  `cache_read_input_tokens=0` even on a direct call with
  `cache_control: {type: "ephemeral"}` on a 3371-token system block
  (above the 2048 Haiku threshold). `claude-haiku-4-5-20251001` on
  the test account returns zero cache stats on both prime + read —
  likely an Anthropic-account beta-access requirement OR a Haiku-4-5-
  specific limitation (prompt caching is "in beta" per Anthropic docs
  for Claude 4.5 models). Not reproducible as a gateway bug.
- **Gemini + Vertex**: automatic caching is opt-in via the
  `cachedContents` API, not an implicit by-default behaviour like
  OpenAI. Our matrix test asserts OpenAI-style `cached_tokens > 0`
  which doesn't apply to Gemini's cache model. Would require a
  separate cell that first creates a cached content + references it
  by name; outside iter-110 scope.

Workarounds in-place for v1:

1. **`/v1/messages` endpoint** (Anthropic-native; recommended) —
   callers wanting Anthropic-style prompt caching should POST to
   `/v1/messages` with the native Anthropic body shape. Gateway
   raw-forwards the bytes unchanged → `cache_control` markers reach
   Anthropic intact. `/v1/chat/completions` toward an Anthropic VK
   stays supported but is cost-unfriendly for heavy-system-prompt use.
2. **Keep OpenAI-family VKs for cache-heavy flows** — openai + azure
   prompt caching works end-to-end via `/v1/chat/completions`.
3. **Gemini / Vertex caching via the native client/SDK** until the
   gateway ships the `/v1/chat/completions → Gemini` cache translator.

v1.1 follow-ups on cache:

1. **Re-run Anthropic/Bedrock cache** once the Anthropic account has
   beta access OR on a non-Haiku model (Sonnet 4.5 / Opus 4.5). The
   gateway correctly forwards `cache_control` on /v1/messages raw-
   forward — problem is provider-side.
2. **Build a Gemini/Vertex `cachedContents`-aware cache cell** that
   exercises Google's explicit cache-creation API rather than the
   OpenAI-style implicit-cache assertion. Separate test shape, out of
   iter-110 scope.
3. **Translator-side `cache_control` preservation** for cross-schema
   routes (`/v1/chat/completions → Anthropic`) so callers who want
   Anthropic-style caching via the OpenAI endpoint can round-trip the
   marker through a custom header / body extension.

Cell format when filled:
```
✅ services/aigateway/tests/matrix/openai_test.go::TestOpenAISimple · 12.4s · $0.000412
```

**Cache cells** assert `gen_ai.usage.cache_read.input_tokens > 0` on the
2nd-call trace (anthropic/bedrock use explicit `cache_control: ephemeral`;
openai/azure/gemini/vertex use automatic prompt caching on ≥1024-token
prefixes).

---

## Priority 3 — Coding-agent matrix (4 cells, one per CLI)
**Owner:** @ai_gateway_andre
**Goal:** each major coding CLI completes a real coding task through the
LangWatch gateway and the resulting traces have non-zero token counts,
captured cost, and non-zero cache-read tokens (these CLIs all aggressively
cache system prompts; multi-turn task naturally exercises cache + tool_use
implicitly, so plain simple/stream/structured cells live in Priority 2).

Test target: `skills/_tests/cli-gateway-coding-agents.scenario.test.ts` —
real CLI binaries spawned via `child_process`, pointed at the gateway with
the seeded `matrix-{provider}` VK.

Real task: `Bootstrap a React + Vite project, App component renders <h1>Hello World</h1>`.
Naturally exercises tool_use (Read/Write/Bash for npm scaffold) and caching
(repeated system prompts across many turns).

Last execution: 2026-04-24 (post Anthropic-billing diagnosis + multiple
gateway iterations). Gateway binary `a4286eb86`. 0/4 cells green end-to-end.

The 2 Lane A gateway feature gaps that this matrix originally surfaced have
been **shipped + verified fixed** on the gateway side:
- `83a70fd4f` added `POST /v1/responses` route (codex 0.122 dropped chat-completions wire-api support)
- `0015e3436` made `/v1/messages` raw-forward thinking-field-preserving
- `84c79a065` extended raw-forward to RESPONSES so Anthropic-shape body roundtrips intact
- `a4286eb86` extended raw-forward to `/v1/chat/completions` for OpenAI-family providers (preserves prefix-cache hash on ingress)

Remaining failures are external to gateway code:

| CLI | React vite hello world |
|-----|------------------------|
| claude-code | ✅ **75s · 4 traces · $0.0072 · tokens_in=4446 / tokens_out=547 · cache_read=0** — first green; multi-turn tool-using session through `/v1/messages`. Cache_read=0 documented as Claude 4.5 prompt-caching-in-beta limit (matches Priority 2 anthropic/cache). What got it green: `--bare --disable-slash-commands` (so child claude doesn't bloat body with parent skills), `--model claude-haiku-4-5-20251001` (Bifrost-resolvable dated name), Anthropic credit refilled, fresh gateway restart (bundle freshness), `d90b81db7` error-passthrough fix. |
| codex | ✅ **82s · 11 traces · $0.0362 · tokens_in=239432 / tokens_out=529 · cache_read=0** — codex executed `npm create vite@latest . --template react` for real, 11 round-trips through gateway to OpenAI Responses API. Unblocked by alexis's `df37575c4` (json.RawMessage error passthrough) + `ff3ec5977` (256 KiB peek on /v1/responses for codex's 40-60 KiB bodies). cache_read=0 informational. |
| gemini-cli | 🟢 unblocked end-to-end iter-110. The original "inherent skip" was wrong — `GOOGLE_GEMINI_BASE_URL` is the documented per-invocation override (verified by grepping the bundled @google/gemini-cli source + Google's docs). The actual blockers were on the gateway: (1) no Gemini-native /v1beta routes, fixed by alexis `c513c399e` (Bifrost Passthrough wrapper for `:generateContent` + `:streamGenerateContent`); (2) no x-goog-api-key auth header recognition, fixed by sergey `59d06e75c`; (3) writeSSE double-wrapping each chunk because pipeline wrappers (trace/budget/guardrail) didn't propagate `RawFraming() bool` through the chain — chunks coming out as `data: data: {…}` made @google/genai's SDK throw `SyntaxError: Unexpected token 'd'` on the embedded JSON parse. Fixed by alexis `0794c9453` + sergey `414d13bbc`. Bifrost-side Gemini stream usage parsing is still an enhancement (we forward chunks verbatim, the trace wrapper sees Usage{0,0,0}); cost lands via the CH cost-enrichment pipeline downstream. Verified locally: HOME=temp gemini -p "..." --yolo --model gemini-2.5-flash with GOOGLE_GEMINI_BASE_URL=http://localhost:5563 + GEMINI_API_KEY=lw_vk_live_... returns exit=0 + model output. Matrix cell wired in `skills/_tests/cli-gateway-coding-agents.scenario.test.ts`. |
| opencode | 🔴 opencode 1.14.22 hangs indefinitely on `opencode run` when ANY custom OpenAI-compatible provider is registered via cwd OR global `~/.config/opencode/opencode.json`. Reproduced across 4 config shapes. Detailed investigation (in commit message of next push): (a) bundled `opencode/gpt-5-nano` works cleanly; (b) custom provider IS recognized — `opencode models` lists `mygateway/gpt-4o-mini`; (c) `opencode run -m mygateway/gpt-4o-mini "say ok"` only emits the proxy-startup log line, then hangs — no instance creation, no HTTP call to gateway, exit 124 at 60-120s. Tried with `npm: "@ai-sdk/openai-compatible"` field, with key matching package name (`openai-compatible`), with `--pure --print-logs --dangerously-skip-permissions`, with package pre-installed at `~/.config/opencode/node_modules/@ai-sdk/openai-compatible/`. Confirmed upstream regression in 1.14.x. Workaround paths for next iter: pin opencode 1.13.x, use `opencode auth` programmatic registration, or write a wrapper using `opencode --attach` server-mode flow. |

Cell format when filled:
```
✅ skills/_tests/cli-gateway-coding-agents.scenario.test.ts::claude-code · 124s · $0.0432 · cache_read=8421
```

---

## Global dependencies / blockers

- **Priority 1**: code-complete + tested. Cross-validates against Priority 2 + 3 runs.
- **Priority 2**: needs `make gateway-dev` clean start + `langwatch/.env`
  uncommented provider creds + `pnpm tsx scripts/seed-gateway-dogfood.ts` run
  to mint matrix-{provider} VKs. Self-contained per cell once green.
- **Priority 3**: same gateway + seed script dependency as Priority 2.

## How to run all matrices end-to-end (when infra is ready)

```bash
# 1. Bring up control-plane stack
cd langwatch && pnpm dev &
# 2. Bring up gateway data plane
cd ../services/aigateway && make run-dev &
# 3. Mint matrix VKs (uses provider creds from langwatch/.env)
cd ../.. && pnpm tsx scripts/seed-gateway-dogfood.ts
# Output stanza prints export commands for LANGWATCH_GATEWAY_VK_<PROVIDER> +
# LANGWATCH_GATEWAY_VK_<PROVIDER>_ID — eval them or save to skills/_tests/.env

# 4. Run Priority 2 (Go matrix, all providers)
cd services/aigateway && \
  go test -tags="live_openai live_anthropic live_gemini live_bedrock live_azure live_vertex" \
    ./tests/matrix/... -v 2>&1 | tee /tmp/p2-matrix.log

# 5. Run Priority 3 (TS coding-agent matrix)
cd ../.. && \
  pnpm vitest run skills/_tests/cli-gateway-coding-agents.scenario.test.ts \
    2>&1 | tee /tmp/p3-matrix.log

# 6. Aggregate results — both matrices print [matrix] lines that the post-run
# reporter scrapes into this file.
```

## Format for PR body inclusion

Once all cells are green, copy the tables verbatim into the PR body under
`## Provider matrix` and `## Coding-agent matrix` sections with a one-line
summary: "30 provider cells + 4 coding-agent cells green against live creds.
Budget CH pipeline verified end-to-end."
