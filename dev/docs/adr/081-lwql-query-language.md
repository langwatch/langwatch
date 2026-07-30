# ADR-081: LWQL — a read-only, tenant-scoped query language and service over traces and spans

**Date:** 2026-07-30

**Status:** Proposed

> One-line: one server-side compiler turns constrained query text into a **closed JSON IR** and then into ClickHouse SQL, exposed through **one service with two transports** (REST + tRPC), so a caller can ask an arbitrary question of their own traces and spans and get a table back — with tenant scope injected by the compiler, every identifier drawn from a developer-authored allowlist, and content-visibility rules applied to filters as well as to output.

## Context

Issue [#6346](https://github.com/langwatch/langwatch/issues/6346). The product requirement is a raw query surface, not a form builder: hit the platform with a query, get whatever you asked for, and drive a chart module off the resulting table — choosing chart type, axes and labels *after* seeing the rows, in the spirit of New Relic or Retool.

Prior art in-repo, and the honest distance:

- [#5670](https://github.com/langwatch/langwatch/issues/5670) / PR [#5709](https://github.com/langwatch/langwatch/pull/5709) — a spike that built a compiler, an aggregation-only IR, and an executed two-tenant isolation proof. **It is an unmerged draft; `trace-query` does not exist on `main`.**
- [#5389](https://github.com/langwatch/langwatch/issues/5389) — the charting investigation, which carried an explicit constraint: *no second timeseries/aggregation engine is introduced*.
- [ADR-034](./034-event-sourced-analytics-materialization.md) -> [ADR-066](./066-projection-clickhouse-cached-store.md) -> [ADR-068](./068-windowed-clickhouse-reads.md) — the analytics read-path substrate, with [#5912](https://github.com/langwatch/langwatch/issues/5912) still in flight over it.

So in shipped terms the starting point is zero, and the design question is not "what do we build" but "which existing read path hosts it."

## Decision

**We will ship LWQL as a single service with two transports, over a closed IR.**

**1. The name is LWQL.** `TRQL` is Trigger.dev's and `TraceQL` is Grafana Tempo's; either would collide the moment it reaches an API path, an SDK method name, or an error string. `LWQL` follows the established convention (PromQL, LogQL, NRQL, KQL, SPL). Reversible today, effectively irreversible after the first SDK release. No trademark search has been performed.

**2. Query text parses into a closed JSON IR, and the IR is the security boundary.** The IR is the compile target; the text surface is a parser front-end that can only emit closed-enum members, so a hostile string cannot become an identifier. Programmatic and agent callers may post the IR directly and skip the parser; humans get text. One compiler, one proof, two entrances.

The spike already demonstrates the shape: every identifier-bearing field derives from a developer-authored map via `z.enum(Object.keys(...))`, with no `z.record`, `z.any`, `z.unknown`, `.passthrough()` or `.catchall()` in the request schema. ClickHouse binds *values*; it never binds identifiers.

**3. v1 covers traces and spans, not traces alone.** `trace_summaries` is a rollup — no tool name, no per-step breakdown. A traces-only language would answer nothing the existing dashboards cannot already answer, shipping a query surface with no question worth asking. Spans cost a per-table tenant-scoping proof and raise the row-count ceiling; that is the price of the feature being useful. Evaluations, experiments and log records are deferred.

**4. One service, two transports.** A single entry point — `runLwqlQuery({ projectId, request, callerId })` — is called by both the REST route and the tRPC procedure; neither transport carries query logic. **Tenant scope is injected by the compiler from the RBAC-checked `projectId`, never read from the request body.** Read-only surfaces must be declared as queries: the spike declared its read path as a tRPC `.mutation()`, which is a defect to correct rather than a pattern to copy.

**5. LWQL compiles to the IR and does not choose storage.** The query layer emits IR and hands it to the existing analytics destination router, which already decides which table or rollup answers a given shape — per the ADR-034 Phase 3 split, `aggregation-builder` now emits only the legacy `trace_summaries` SQL as a fallback while destination routing lives in `~/server/app-layer/analytics`. LWQL therefore names no tables.

This resolves the engine question without choosing an engine, and it decouples LWQL from [#5912](https://github.com/langwatch/langwatch/issues/5912): the fold-projection rewrite happens *behind* the router, so it sequences independently of this work rather than blocking it.

Existing time-bucketing is reused rather than re-derived. `getDateTruncFunction` is already timezone-correct across minute / interval / day / week / month, threading a validated timezone through each branch. Re-deriving calendar bucketing is a classic source of defects that stay latent for a year.

**6. Content-visibility rules apply to filter and aggregation targets, not only to output columns.** A field subject to content gating is gated identically wherever it appears in a query, not merely where it would be returned.

The gated field set is **derived from `app-layer/traces/visibility-window.service`**, never restated in the query layer. That service is the existing definition of what counts as content — `redactTraceContent` covers `input`, `output`, `expected_output`, `contexts` and `error`; `redactSpanContent` covers `input`, `output`, `error` and `params`. A hand-maintained parallel list in the query layer would drift the moment a field is added to either, and the drift would be silent. **A test asserts parity**, so extending the redaction set without teaching LWQL about it fails CI rather than shipping.

**7. Synchronous by default, with async for expensive queries, and caps are v1 gates.** A row cap and a maximum queryable time-span ship in v1 rather than as follow-ons, per the product requirement that unbounded scans be prevented by default. Queries exceeding the synchronous budget are executed asynchronously with pagination over the result. The existing per-tenant `TenantRateLimiter` — tiered and tested, currently wired only into the websocket broadcast path — is reused rather than duplicated.

**8. `explain` is internal-only in v1.** Returning generated SQL is a debugging affordance for internal users, not a public API capability. It can widen later; a public `explain` cannot be narrowed once SDKs depend on it.

## Rationale / Trade-offs

The load-bearing choice is *allowlist-totality*: every dimension, metric and aggregation is a closed enum mapped to a developer-authored ClickHouse expression. This is what makes a user-supplied query language safe to expose at all, and it is why schema disclosure is cheap — knowing the table shape buys an attacker nothing when the identifier set is closed.

It also sets the cost: every new queryable column is a deliberate act. That is the intended trade. Starting restrictive and widening is reversible; starting permissive and narrowing is not, because by then the data has left. Where a question resolved asymmetrically, we resolved it toward the reversible direction.

Decision 6 follows the same asymmetry. Gating a field's output while leaving it available as a filter target satisfies a projection-only rule without actually withholding the field, so the rule is stated over *every* position a field can occupy in a query. Deriving that set from the redaction service rather than restating it is the difference between a rule that holds and a rule that held on the day it was written.

We rejected a structured form/filter UI because it inverts the requirement: a form can only ask questions someone anticipated, and the point of this surface is the unanticipated question.

## Consequences

- **ADR-028 needs an amendment from its owner.** Its summary states that "existence, timestamps, and **aggregates stay fully visible**" — a carve-out written when aggregates meant fixed, developer-authored dashboard charts, and which predates any caller-supplied-filter aggregate surface. Decision 6 is LWQL's local resolution; the platform-level rule belongs in ADR-028 itself. That ADR is also still `Status: Proposed` while its service layer ships, which should be corrected independently.
- **Engine drift between the two candidate read paths must be reconciled, not inherited.** The spike emits bare `arrayJoin(Models)` while the analytics builder emits `arrayJoin(if(empty(Models), ['unknown'], Models))`. Traces with no models are silently dropped by one and bucketed as `unknown` by the other — two different numbers for one question, before either has shipped.
- **Every queryable column is an ongoing cost.** Allowlist-totality means the schema does not grow by accident; adding a field is a code change with a review, by design.

## References

- Issues: [#6346](https://github.com/langwatch/langwatch/issues/6346) (this work), [#5670](https://github.com/langwatch/langwatch/issues/5670) (spike), [#5389](https://github.com/langwatch/langwatch/issues/5389) (charting), [#5912](https://github.com/langwatch/langwatch/issues/5912) (analytics read path, in flight)
- PR: [#5709](https://github.com/langwatch/langwatch/pull/5709) (spike, unmerged draft)
- Related ADRs: [028](./028-visibility-blur-teaser-redaction.md), [034](./034-event-sourced-analytics-materialization.md), [066](./066-projection-clickhouse-cached-store.md), [068](./068-windowed-clickhouse-reads.md)
