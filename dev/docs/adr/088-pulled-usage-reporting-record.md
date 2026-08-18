# ADR-088: pulled provider usage is a priced, per-item cost record written to the shared usage ledger under a non-enforcing scope

**Date:** 2026-08-06

**Status:** Accepted

**Relates to:** the shipped event-sourced pull pipeline (`platform/app/ee/event-sourcing/pipelines/ingestion-pull-processing/`), delivered by the June event-sourcing migration that dropped BullMQ and refactored into the one-declaration-per-pipeline model (#6051; restructure #6405). Mirrors the gateway spend pattern in `platform/app/src/server/event-sourcing/pipelines/gateway-spend-processing/` and, critically, the way the **Claude Code OTLP receiver already surfaces ingestion cost** through `gateway_budget_ledger_events` (`platform/app/ee/governance/services/personalUsage.clickhouse.repository.ts`). Depends on the scope-resolution consolidation (#6551). Provider grounding: an internal integration spike (Databricks Genie on Azure) and the audit-table husk finding.

> **One line:** each pulled usage item becomes a **priced, provider-agnostic event**; its cost is written to the **shared usage ledger under a dedicated non-enforcing scope** — the same table the "my usage" screens already read, marked so it shows in reporting but never trips a spending limit — attributed to the customer's real org/team/project, with restatement handled by a **stable-coordinate key that excludes cost**.

**In plain terms.** We pull the record of what a customer already spent directly with a provider, turn each usage chunk into one clean cost record, and put it where their usage screens already look — flagged so it shows up in reports but can never block anything. We keep it correct when the provider revises a number, and we're honest about which numbers are exact and which are estimates.

## Context

The pull framework already shipped and is event-sourced for **orchestration** (cron wake, cursor, run lifecycle). What is not on any stream is the **data**: `RUN_COMPLETED` carries only a count, and the puller effect direct-writes the usage rows and cost into `governance_ocsf_events` (`pullerWorker.ts:211-244`), an audit table, with cost buried in `metadata.extension.cost_usd`. So pulled cost is invisible to every usage screen and unattributed to a real tenant.

**There is no single "spend view" — this is the load-bearing fact.** Three customer-facing cost surfaces each read a *different* physical table:

- Gateway spend/billing → `gateway_spend` (`spendEvents.clickhouse.repository.ts:24`).
- Personal / Claude-Code usage (`/me/usage`) → `gateway_budget_ledger_events` **UNION** `trace_summaries` (`personalUsage.clickhouse.repository.ts`).
- Analytics cost dashboard (`metrics.total_cost`) → `trace_summaries` (`analytics/.../field-mappings.ts:222-225`).

And the pattern for *ingestion* cost already exists: the Claude Code OTLP receiver writes into `gateway_budget_ledger_events`, and `/me/usage` reads that cost through a scope-filtered query (`personalUsage.clickhouse.repository.ts`). So "reporting" and "enforcement" are **not separate tables** — they are the same ledger; enforcement is driven by which rows a *real budget* resolves to, not by a scope flag. Any design that lands pulled cost in a brand-new isolated table is read by nobody and fails its own visibility goal.

**Forcing function.** Databricks Genie on Azure is the first provider we want to connect.

**Locked constraints (Phase 1).** Build on the existing puller — no second pull system. Keep cost as its own clean record (a first-class cost row, not buried in the OCSF audit log). Reuse the existing pricing code.

**The boundary that matters.** Pulled money was spent *outside* our gateway and cannot be blocked; it must never drive enforcement. But — per the shipped Claude Code pattern — "don't enforce" is a **scope on the shared ledger**, not a separate store.

## Decision

**1. One priced event per pulled usage item, keyed by stable provider coordinates.** A provider-agnostic aggregate (`pulled_usage`), one event per usage chunk. The item's identity is the provider's **stable natural key**: for bucketed admin APIs (Anthropic usage/cost report) that is `(tenant, period, granularity, model, workspace, …group-by dims)` — there is no message id; for per-message providers (Genie) it is the message id. We reject bolting usage onto `RUN_COMPLETED` (per-run grain) and reject "aggregateId = message id" as universal (bucket APIs have none — the v1 error the red-team caught).

**2. Price once, at the ingest seam.** The command that mints the event stamps cost as an integer `costNanoUsd` (plus a `rateVersion` for the *computed* path only; `null` when the provider reported an exact cost); downstream copies it, never recomputes (as `gateway-spend-processing/schemas/commands.ts:120-155` does). Where the provider returns an exact cost (Anthropic `cost_report`) we carry it; where it returns only quantities (Anthropic `usage_report` tokens) we price once with `estimateCost()` (`tracer/collector/cost.ts`). The two-ways-to-get-Anthropic-cost seam is handled in Decision 6.

**3. Write cost to the shared usage ledger through a dedicated writer, under a structurally non-enforcing scope `"pulled"`.** Pulled cost is written to `gateway_budget_ledger_events` (the table `/me/usage` already reads) through a **dedicated writer** (`insertPulledUsageRows`) with a constant `Scope = "pulled"` and a **synthetic budget id** (the ledger's storage key requires one). Non-enforcement is **structural, not a flag**: enforcement resolves real `GatewayBudget` rows and sums only ledger rows whose `BudgetId`/`Scope` match a real budget — and no budget can carry `"pulled"` (it is not a `GatewayBudgetScopeType`), so no resolver ever reaches these rows. A **dedicated read** — mirroring the *read* shape of the existing principal-usage query (filter by `Scope`+`ScopeId`+tenant, **not** `BudgetId`) — surfaces pulled cost in `/me/usage`. Pulled rows are **excluded from the spend-rollup materialized view** so they can never leak into a budget total. We reject extending `GatewayBudgetScopeType` (a budget could then be created under `"pulled"`, breaking non-enforcement by construction), a separate isolated rollup table (invisible — the #1 red-team kill), and any enforcing-scope write. *(The earlier draft's `Scope='principal'` analogy was imprecise: principal rows carry real budgets and do enforce; only the read filter is what we mirror.)*

**4. Attribute to the customer's real org/team/project.** `IngestionSource` today carries `organizationId` (required) + `teamId` (optional) but **no `projectId`**, and all writers currently land under the hidden governance project (`pullerWorker.ts:204-208`). So this decision *requires explicit schema work*: (a) add a project scope to `IngestionSource`, and (b) reconcile the hidden-governance-project routing every writer uses. Until (a)+(b) land, attribute at **org/team** (which the model supports today) and treat project as unattributed rather than silently the governance project. Named-person attribution (Genie object-id) is deferred behind #6551.

**5. Corrections are a fresh record; newest wins; the key excludes cost.** A restated bucket is a new event whose identity key is the **stable coordinates from Decision 1 with cost and quantities excluded** — a dimension-only hash (the same shape PostHog's connector uses, and the shape our own research recommended). An unchanged re-pull produces the identical key → no-op; a corrected bucket produces the *same* key with a later **`observedAt`** (the monotonic time we pulled it) → latest-by-`observedAt` replaces. Ordering must be `observedAt`, **not** the bucket's business `occurredAt`: a restatement of period P keeps P's `occurredAt`, so versions cannot be ordered by it. We reject hashing cost into the key (the v1 error: a corrected cost would mint a new key and double-count) and reject relying on storage-engine merge order.

**6. Each record is flagged `exact` or `estimate`, and same-money supersede is a named reconciliation.** Anthropic `cost_report` → `exact`; Anthropic `usage_report`-priced and Databricks DBU → `estimate`. Two reconciliations, both deferred but named here (not Databricks-only, as v1 wrongly implied): (i) an `estimate` trued up to the invoiced number; (ii) the **same Anthropic spend arriving via both `usage_report` and `cost_report`** — per provider we either pull usage XOR cost, or define a supersede rule where `provider_reported` replaces `computed` for the same coordinates. Until a supersede rule ships, a provider adapter pulls **one** of the two, never both.

**7. Provider-agnostic by construction; Databricks is the first adapter.** The event, the ledger scope, and the reconciliation are provider-neutral; the puller's adapter registry already exists. Databricks is the first adapter; the second provider is only an adapter.

## Constants

| Name | Value | Purpose |
|---|---|---|
| Aggregate | `pulled_usage` | one stream per usage item |
| Item identity | provider stable coordinates (bucket dims) or message id | dedup + restatement key |
| Ledger scope | constant `Scope = "pulled"` + synthetic `BudgetId` | structurally non-enforcing — no budget can carry it |
| Cost unit | integer `costNanoUsd` | summed money; display `Decimal` derived, never summed |
| `rateVersion` | string, **null for `provider_reported`** | which price table produced a *computed* cost |
| `costBasis` | `provider_reported` \| `computed` | did the provider give cost, or did we price it |
| `costStatus` | `exact` \| `estimate` | final vs pre-invoice |
| Restatement key | dimension-only hash (**cost/quantities excluded**) | unchanged re-pull = no-op; correction = replace |
| Version / ordering | `observedAt` (monotonic pull time) | latest version wins; **not** bucket `occurredAt` |

## Invariants

| Invariant | Test anchor |
|---|---|
| Enforcement/budget resolution never acts on the pulled scope | test: budget resolver over a pulled-scope row returns no debit; a limit is never tripped by pulled cost |
| Cost priced exactly once | test: known payload → assert the same stored integer at every downstream read |
| Unchanged re-pull is a no-op; a restatement replaces, never adds | test: re-pull identical bucket (no new row); re-pull corrected cost (total replaced, key unchanged because cost is excluded) |
| Pulled and gateway spend are never summed into one total without request-id reconciliation | test: a gateway request + a pulled record for the same usage are not collapsed into one figure; reporting keeps `source` distinct |
| Pulled cost is attributed to org/team (or explicitly unattributed), never silently the governance project | test: a report row's scope is the source's configured org/team, or flagged unattributed |

## Assumptions

| Assumption | What breaks if false |
|---|---|
| One writer produces each usage record (the pull) | "priced once / newest wins" becomes ambiguous |
| A provider restates a bucket under the **same stable coordinates** | the correction can't match the original; both persist (silent double-count) |
| The tenant boundary is enforced upstream of the ledger write | pulled cost reported under the wrong customer |
| `IngestionSource` can be extended to carry the target project | Decision 4's project attribution has no home (named as required work, not assumed done) |

## Gates

| Path | Reversible? | Blast radius | Gate |
|---|---|---|---|
| Owner alignment before implementation | — | — | **hard gate** — pipeline-owner sign-off on the sibling-`pulled_usage` shape. **Satisfied 2026-08-06.** |
| New `pulled_usage` event + ledger write | reversible | medium | automated — types + tests + feature flag |
| The `"pulled"`-scope non-enforcement boundary | effectively irreversible (money) | large | human review + a resolver test asserting no budget/enforcement path ever reaches `Scope="pulled"` |
| Migration: exclude `Scope="pulled"` from the spend-rollup MV | irreversible | large | tested; commented-out down (house rule) |
| `projectId` on `IngestionSource` (deferred) | irreversible | large | when built: tested, commented-out down |
| Estimate→invoice & usage↔cost supersede | — | — | deferred; named in Open questions |

## Schema (shape, not final)

```text
event PulledUsageObserved {
  itemKey        string    // stable coordinates (bucket dims) or provider message id
  restatementKey string    // dimension-only hash — cost & quantities EXCLUDED
  source         string    // "anthropic_admin" | "databricks_genie" | ...
  organizationId string
  teamId         string?
  projectId      string?   // requires new IngestionSource.projectId; null = unattributed, never the governance project
  model          string
  tokens*        uint      // where applicable
  costNanoUsd    int64     // priced ONCE
  rateVersion    string?   // null for provider_reported; set for computed
  costBasis      enum(provider_reported, computed)
  costStatus     enum(exact, estimate)
  occurredAt     datetime  // provider business bucket time
  observedAt     datetime  // monotonic pull time — the restatement ordering field
}
// → gateway_budget_ledger_events via insertPulledUsageRows: constant Scope="pulled",
//   synthetic BudgetId, EXCLUDED from the spend-rollup MV. Read by a dedicated scope-filtered query.
// New: IngestionSource.projectId (deferred); migration numbers assigned at build.
```

## Rejected alternatives

- **Separate isolated `pulled_usage_rollup` table** — read by none of the three spend surfaces; invisible. (The #1 red-team kill of v1.)
- **Write under an enforcing scope / debit budgets, or extend `GatewayBudgetScopeType`** — blocks money spent outside the gateway, double-counts gateway users, and (the enum route) lets a budget be created under the pulled scope, breaking non-enforcement by construction.
- **`aggregateId` = message id for all providers** — bucketed admin APIs have no message id.
- **Hash cost into the restatement key** — a corrected cost mints a new key → double-count instead of replace.
- **Report under the hidden governance project** — invisible to the customer.
- **Rely on ReplacingMergeTree merge order for restatement** — stale reads on a money number.
- **A second parallel pull system** — excluded by the Phase-1 constraint.

## Consequences

**Positive.** Pulled cost becomes visible in the screens customers already use (via the ledger they already read), attributed to org/team, correct under restatement, honest about exact-vs-estimate. Provider-agnostic — the second provider is an adapter. Reuses the shipped Claude Code ingestion-cost pattern rather than inventing one.

**Negative.** Pulled cost never drives enforcement (by design). Real-*project* attribution and both reconciliations (invoice true-up; Anthropic usage↔cost supersede) are named follow-ups, not in v1. Pulled + gateway cannot be safely summed into one "total AI spend" where the provider admin API omits a request id — a real, stated limit.

**Neutral.** The OCSF audit write is untouched by this ADR, but keeping it *and* the new event means two writers of the same data — see Open questions.

## Open questions

- **Owner alignment — a hard pre-implementation gate, satisfied 2026-08-06.** The pipeline owner signed off on the sibling-`pulled_usage` shape (the shipped `eventCount`-only `RUN_COMPLETED` is per-run and stays; pulled usage is its own aggregate). Promoted from a framing note to an explicit gate per review.
- **Single source vs two writers.** Should `PulledUsageObserved` become the single source that also feeds the OCSF audit projection, retiring the direct write? Recommended yes; decide with the owner.
- **`IngestionSource.projectId` + governance-tenant reconciliation** (Decision 4) — schema + routing work, named but not designed here.
- **Reconciliation** — estimate→invoice true-up, and the Anthropic usage↔cost supersede rule (Decision 6).
- **Pulled↔gateway dedup** — impossible where the admin API omits a request id; decide the reporting rule (never co-sum) explicitly in the UI layer.
- **Named-person attribution** — Genie object-id, after #6551.

## Revisions

- **v1 (2026-08-06)** — initial proposal. Framing: make pulled usage/cost first-class (reporting), Databricks first, real-money blast radius. Phase-3 rounds: per-item event; reuse the gateway spend shape; fresh-record-newest-wins; team/project attribution now, named-people later; exact/estimate flag. Mid-round correction: routing pulled cost through *budget enforcement* was wrong (pull observes, cannot block), moving Decision 3 to "reporting only."
- **v2 (2026-08-06)** — folded a mandatory red-team pass (money/data blast radius). **Two v1 claims died:** (#1) "separate reporting table" was invisible — no single spend view exists; three surfaces read three tables, and Claude Code ingestion cost already surfaces via `gateway_budget_ledger_events` under a non-enforcing scope — so Decision 3 changed from "new table, never the ledger" to "**the shared ledger under a non-enforcing scope**." (#4) the restatement key hashed cost and assumed a message id — Decision 1/5 changed to **stable bucket coordinates with cost excluded**. Narrowed and named: (#3) `IngestionSource` has no `projectId` and writers use the governance tenant — Decision 4 now names that schema work; (#2) pulled↔gateway double-count stated as a hard limit; (#5) the Anthropic usage↔cost supersede folded into reconciliation, no longer mislabeled Databricks-only.
- **v5 (2026-08-07) — reference maintenance (no decision change).** Rebased onto #6622 (a ClickHouse repository-access refactor): the mirrored principal read moved from `personalUsage.service.ts` into `personalUsage.clickhouse.repository.ts`; ADR and code-comment references updated. Also: the "shows in `/me/usage`" phrasing is shorthand — visibility is a dedicated org/team pulled-usage read against the same ledger, not the per-user screen. Implementation shipped on PR #6649; an independent review caught and fixed a migration (00073) that had dropped `SpendNanoUSD` from the enforcement rollup before it could reach anyone.
- **v4 (2026-08-06) — mechanism refinement (still Accepted).** Folded the implementation surface map + a CodeRabbit review. **Decision 3's mechanism corrected:** non-enforcement is *structural*, not a scope flag — pulled rows use a dedicated writer (`insertPulledUsageRows`) under constant `Scope="pulled"` + a synthetic budget id, are surfaced by a dedicated scope-filtered read (mirroring the principal *read*, not its write), and are excluded from the spend-rollup MV; `GatewayBudgetScopeType` is **not** extended. The `Scope='principal'`-as-non-enforcing analogy was imprecise and is corrected. **Decision 5's ordering fixed:** latest-by-`observedAt` (monotonic pull time), not bucket `occurredAt` (unchanged across a same-period restatement). Field naming unified to `costNanoUsd`/`rateVersion`, with `rateVersion` null for `provider_reported`. Owner alignment promoted to an explicit pre-implementation gate, **satisfied**. Doc-lint nits (fenced-block language, wording) fixed. Decision *intent* unchanged. Captain: *(decision owner)*.
- **v3 (2026-08-06) — Accepted / locked.** The decision owner chose to lock the *direction* now. Implementation still gates on the owner-alignment open item: the pipeline-owner conversation happens before any code, and if it reveals the shipped `eventCount`-only shape is a deliberate step this ADR should extend, that becomes a v4 revision — not a quiet edit. Captain: *(decision owner)*.

## References

- Shipped pull pipeline: `platform/app/ee/event-sourcing/pipelines/ingestion-pull-processing/` · effect `ee/governance/services/pullers/pullerWorker.ts`
- The ingestion-cost pattern we mirror: `personalUsage.clickhouse.repository.ts` (Claude Code → `gateway_budget_ledger_events` under `Scope='principal'`; moved here from the service by #6622)
- Spend read surfaces: `spendEvents.clickhouse.repository.ts:24` · `personalUsage.clickhouse.repository.ts` · `analytics/.../field-mappings.ts:222-225`
- Pattern & pricing: `gateway-spend-processing/` · `tracer/collector/cost.ts`
- Prior investigations: internal pull-API-surface and audit-table-husk records; #6551 (governance scope resolution) · house rule: [ADR-087](./087-trace-summary-storage-anchor.md)
