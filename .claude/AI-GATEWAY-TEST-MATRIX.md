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

Last execution: 2026-04-24. Gateway binary `b98a752dc`. Live run against
real provider credentials; traces + costs captured on the LangWatch
platform (`/api/trace/:id`).

| Provider | Simple | Streamed | Tool calling | Structured outputs | Cache |
|----------|--------|----------|--------------|--------------------|-------|
| openai    | ✅ 2.95s · \$0.000035  | ✅ 26.20s · \$0.000101 | ✅ 10.60s · \$0.000162 | ✅ 18.95s · \$0.000135 | ✅ 36.28s · \$0.000255 (gpt-4o-mini) |
| anthropic | ✅ 5.85s · \$0.000035  | ✅ 9.71s · \$0.000086  | ✅ 5.61s · \$0.000839  | ✅ 5.33s · \$0.000161  | ⚠️ v1 limit — use /v1/messages |
| gemini    | ✅ 9.87s · \$0.000075  | ✅ 5.14s · \$0.000099  | ✅ 9.83s · \$0.000253  | ✅ 3.60s · \$0.000178  | ⚠️ v1 limit — cross-schema |
| bedrock   | ✅ 11.44s · \$0.000035 | ✅ 17.80s · \$0.000086 | ✅ 5.72s · \$0.000146  | ✅ 15.33s · \$0.000135 | ⚠️ v1 limit — cross-schema |
| azure     | ✅ 13.82s · \$0.000035 | ✅ 18.63s · \$0.000080 | ✅ 10.55s · \$0.000152 | ✅ 27.33s · \$0.000128 | ✅ 21.39s · \$0.000489 |
| vertex    | ✅ 3.55s · \$0.000047  | ✅ 6.26s · \$0.000084  | ✅ 5.79s · \$0.000146  | ✅ 9.42s · \$0.000178  | ⚠️ v1 limit — cross-schema |

**Final: 26/30 end-to-end green. Cache supported on byte-preserving
OpenAI-family paths (openai + azure) via `/v1/chat/completions`; cross-
schema translation `/v1/chat/completions → anthropic/gemini/bedrock/vertex`
does not preserve `cache_control` markers — v1.1 follow-up.**

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
| claude-code | 🟡 BLOCKED on Anthropic billing — gateway returns 502 with the upstream error `"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."` Anthropic API key needs credit at console.anthropic.com. Gateway pipeline verified working via direct curl returning Anthropic-shape body with cache_*_input_tokens. |
| codex | 🔴 `/v1/responses` route now exists but Bifrost dispatch returns 504 `HTML response received from provider` from upstream OpenAI. Distinct from claude-code billing — needs separate Lane A investigation (Bifrost ResponsesRequest URL/auth, gpt-5-mini Responses-API eligibility, or model-name mismatch). |
| gemini-cli | ⏭️ `t.skip` with reason — upstream gemini-cli has no base-url flag; needs upstream change OR /etc/hosts override OR proxy wrapper |
| opencode | 🔴 opencode 1.14.22 installed but `OPENCODE_CONFIG_HOME` + `opencode.json` config approach my test uses doesn't route opencode's calls through the gateway — gateway log shows zero opencode-source requests after a 114s session. Needs investigation of opencode 1.14's correct non-interactive custom-baseURL setup (auth CLI flow, plugin, env var, etc.). |

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
