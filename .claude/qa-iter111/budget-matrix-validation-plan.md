# Budget × Matrix Validation Plan (iter 111)

## Goal

Validate end-to-end that gateway budgets correctly:
1. **Count spend** as the matrix runs (CI matrix → CH `gateway_budget_scope_totals` → frontend display)
2. **Enforce breach** by returning 429 `budget_exceeded` when spend crosses limit (local dogfood scenario)

Two distinct configurations because rchaves wants both signals: budget counting (without false breaches polluting CI) AND breach enforcement (visible mid-run).

## Pre-requisites

- Andre's #4 PG→CH cutover landed (so reads come from CH, not stale PG `spentUsd` column)
- MATRIX_* org/repo secrets populated by rchaves (otherwise matrix tests t.Skip and no spend lands)
- Seed extension landed (see "Setup" below)

## Setup

Extend `langwatch/scripts/seed-gateway-dogfood.ts`:

1. Add CLI flag `--budget-mode=ci|breach` (default `ci`).
2. Replace the single `matrix-openai monthly` budget creation (currently at line 207-218) with a loop over all 6 matrix VKs (`matrix-openai`, `matrix-anthropic`, `matrix-gemini`, `matrix-bedrock`, `matrix-azure`, `matrix-vertex`).
3. Per-VK budget params per mode:

| Mode    | window | limitUsd | onBreach | name                    |
|---------|--------|----------|----------|-------------------------|
| `ci`    | MONTH  | 10       | BLOCK    | `matrix-{vk} monthly`   |
| `breach`| HOUR   | 0.005    | BLOCK    | `matrix-{vk} breach`    |

Both modes use `BLOCK` not `WARN` — `BLOCK` is the actual enforcement mode we ship to customers, so test exercises the real code path.

## CI counting validation (mode=ci)

**Run sequence:**
1. Re-seed local DB: `pnpm tsx scripts/seed-gateway-dogfood.ts --budget-mode=ci`
2. Trigger matrix workflow (manual dispatch or PR push)
3. Wait ~5min for matrix run + trace-fold reactor settle

**Backend assertions:**
- CH query: `SELECT Scope, ScopeId, finalizeAggregation(sumMerge(SpendUSD)) AS spend FROM gateway_budget_scope_totals WHERE TenantId = '<project_id>' AND Scope = 'virtual_key' GROUP BY Scope, ScopeId` should show 6 rows (one per matrix VK), each `spend > 0`
- Sum: total ≈ $0.07 (workflow's documented spend per full run — matches `cell <provider>/<scenario>: ... captured_cost=$<usd>` log lines summed)

**Frontend QA (browser-qa skill, capture screenshots):**
- `/[project]/gateway/budgets` — all 6 matrix budgets list with non-zero `spentUsd`, color-coded under-limit
- `/[project]/gateway/budgets/[id]` — drill-in shows per-VK spend curve, recent ledger entries (CH-sourced post-cutover)
- `/[project]/gateway/usage` — cost-per-day sparkline shows the spend
- `/[project]/gateway/virtual-keys/[id]` — per-VK activity + cost surfaces

**Pass criteria**: 4 screenshots showing non-zero matrix spend + CH query result confirming sum.

## Breach validation (mode=breach)

**Run sequence:**
1. Re-seed local DB with breach budgets: `pnpm tsx scripts/seed-gateway-dogfood.ts --budget-mode=breach`
2. Either:
   - Manual: hand-curl 5-10 completions through one matrix VK
   - Automated: run a single matrix provider's cells, watch breach
3. Watch first 2-3 succeed (spend < $0.005), rest get HTTP 429 `budget_exceeded`

**Backend assertions:**
- Gateway dispatcher logs show `budget_exceeded` rejections for the post-breach requests
- CH `gateway_budget_scope_totals` shows spend > $0.005 for the breached VK
- Trace from breached requests shows `langwatch.budget_exceeded=true` attribute (per the budget-blocked classification path)

**Frontend QA:**
- `/[project]/gateway/budgets/[id]` — budget detail shows red 'EXCEEDED' badge, `spentUsd > limitUsd`, breach timestamp
- `/[project]/gateway/usage` — usage chart highlights the breach window
- `/[project]/gateway/audit` — audit log shows `budget.exceeded` events for the rejected requests

**Pass criteria**: Screenshots of breach state + observed 429 responses.

## Rollback / cleanup

- After breach validation: re-run `--budget-mode=ci` to restore generous budgets so subsequent dogfood doesn't keep tripping breaches
- (If running in production-shaped env): manually delete the breach budgets via `/api/internal/gateway/budget/:id` DELETE

## Open questions

- Does `onBreach: BLOCK` enforce hard at the gateway dispatcher (returns 429 immediately) or soft (allows the in-flight request and blocks the NEXT one)? — Need to verify current behavior matches matrix expectation; if soft-only, tighten budget further so even 1-2 cells trigger a clean breach.
- Post-cutover, does the budget detail page's "recent ledger entries" table read from CH `gateway_budget_ledger_events` (per-event) or only show aggregated totals? — Needs Andre's cutover commit to confirm.

## Owners

- **Seed script extension** (this task): @ai_gateway_alexis_2 (Lane B, deferred until Andre's cutover lands)
- **Run + CH backend assertions**: anyone with MATRIX_* secrets access
- **Frontend QA + screenshots**: @ai_gateway_alexis_2 (browser-qa skill)
- **PR body update with results**: @ai_gateway_andre (PR-body lane)
