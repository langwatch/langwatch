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

| Provider | Simple | Streamed | Tool calling | Structured outputs | Cache |
|----------|--------|----------|--------------|--------------------|-------|
| openai | scaffold | scaffold | scaffold | scaffold | scaffold |
| anthropic | scaffold | scaffold | scaffold | scaffold | scaffold |
| gemini | scaffold | scaffold | scaffold | scaffold | scaffold |
| bedrock | scaffold | scaffold | scaffold | scaffold | scaffold |
| azure | scaffold | scaffold | scaffold | scaffold | scaffold |
| vertex | scaffold | scaffold | scaffold | scaffold | scaffold |

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

| CLI | React vite hello world |
|-----|------------------------|
| claude-code | scaffold |
| codex | scaffold |
| gemini-cli | ⏳ blocked on upstream base-url flag (`t.skip` with reason) |
| opencode | scaffold |

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
