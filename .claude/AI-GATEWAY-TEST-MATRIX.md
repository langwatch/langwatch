# AI Gateway Test Matrix

Shared tracking artifact for the three-priority verification push ordered by rchaves
on the iter 109+ branch (ralph-loop multi-agent coordination).

Each row appended as tests pass end-to-end. Paths are relative to the repo root.

---

## Priority 1 — Budget ClickHouse event-sourcing pipeline
**Owner:** @ai_gateway_alexis_2
**Goal:** verify full trace → reactor → CH rollup → `/budget/check` enforcement, no mocks.

| # | Surface | Test file | Duration | Captured cost | Status |
|---|---------|-----------|----------|---------------|--------|
|   | gatewayBudgetSync reactor | _(pending write)_ | — | — | ⏳ scaffold |
|   | CH fold: one trace → N budget rows | _(pending)_ | — | — | ⏳ |
|   | `/budget/check` reads CH totals | _(pending)_ | — | — | ⏳ |
|   | Over-budget request returns 402 | _(pending)_ | — | — | ⏳ |
|   | Idempotency: replay trace | _(pending)_ | — | — | ⏳ |

---

## Priority 2 — Provider matrix (6 × 4)
**Owner:** @ai_gateway_sergey_2
**Goal:** every provider × every call shape works, tokens + cost land on the platform.

Test target: Go integration tests against real gateway binary, real provider credentials, trace asserted in ClickHouse post-run.

| Provider | Simple completion | Streamed completion | Tool calling | Structured outputs |
|----------|------|------|------|------|
| openai |  |  |  |  |
| anthropic |  |  |  |  |
| gemini |  |  |  |  |
| bedrock |  |  |  |  |
| azure |  |  |  |  |
| vertex |  |  |  |  |

Cell format when filled:
```
✅ path/to/test.go · 12.4s · $0.000412
```

---

## Priority 3 — Coding-agent matrix
**Owner:** @ai_gateway_andre
**Goal:** each major coding CLI routed through the LangWatch gateway completes a real
coding task, traces + costs captured.

Test target: `skills/_tests/cli-gateway-coding-agents.scenario.test.ts` — real CLI
binaries spawned via child_process, pointed at the gateway with a VK.

| CLI | Simple task | Long session with caching | Tool use |
|-----|------|------|------|
| claude-code |  |  |  |
| codex |  |  |  |
| gemini-cli |  |  |  |
| opencode |  |  |  |

Cell format when filled:
```
✅ skills/_tests/… · 45.2s · $0.00821
```

---

## Global dependencies / blockers

- **Priority 1** blocks nothing; can run standalone.
- **Priority 2** needs `make gateway-dev` clean start + real provider creds. Self-contained once green for 1 cell.
- **Priority 3** needs **at least one cell of Priority 2 green** (anthropic-simple unblocks claude-code; openai-simple unblocks codex + opencode; gemini-simple unblocks gemini-cli).

## Format for PR body inclusion

Once all cells are green, copy the tables verbatim into the PR body under
`## Provider matrix` and `## Coding-agent matrix` sections. Include a one-line summary:
"24 provider cells + 12 coding-agent cells green against live creds. Budget CH pipeline
verified end-to-end."
