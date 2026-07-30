# ADR-081: LWQL — a read-only, tenant-scoped query language and service over traces and spans

**Date:** 2026-07-30

**Status:** Draft

> One-line: one server-side compiler turns constrained query text into a **closed JSON IR** and then into ClickHouse SQL, exposed through **one service with two transports** (REST + tRPC), so a caller can ask an arbitrary question of their own traces and spans and get a table back — with tenant scope injected by the compiler and every identifier drawn from a developer-authored allowlist.

## Context

Issue [#6346](https://github.com/langwatch/langwatch/issues/6346). The product requirement is a raw query surface, not a form builder: hit the platform with a query, get whatever you asked for, and drive a chart module off the resulting table — choosing chart type, axes and labels *after* seeing the rows, in the spirit of New Relic or Retool.

Prior art in-repo, and the honest distance:

- [#5670](https://github.com/langwatch/langwatch/issues/5670) / PR [#5709](https://github.com/langwatch/langwatch/pull/5709) — a spike that built a compiler, an aggregation-only IR, and an executed two-tenant isolation proof. **It is an unmerged draft; `trace-query` does not exist on `main`.**
- [#5389](https://github.com/langwatch/langwatch/issues/5389) — the charting investigation, which carried an explicit constraint: *no second timeseries/aggregation engine is introduced*.
- [ADR-034](./034-event-sourced-analytics-materialization.md) -> [ADR-066](./066-projection-clickhouse-cached-store.md) -> [ADR-068](./068-windowed-clickhouse-reads.md) — the analytics read-path substrate, with [#5912](https://github.com/langwatch/langwatch/issues/5912) still in flight over it.

So in shipped terms the starting point is zero, and the design question is not "what do we build" but "which existing read path hosts it."

## Decision

**We will ship LWQL as a single service with two transports, over a closed IR.** Four parts are settled; the rest is listed as open rather than implied.

**1. The name is LWQL.** `TRQL` is Trigger.dev's and `TraceQL` is Grafana Tempo's; either would collide the moment it reaches an API path, an SDK method name, or an error string. `LWQL` follows the established convention (PromQL, LogQL, NRQL, KQL, SPL). Reversible today, effectively irreversible after the first SDK release. No trademark search has been performed.

**2. Query text parses into a closed JSON IR, and the IR is the security boundary.** The IR is the compile target; the text surface is a parser front-end that can only emit closed-enum members, so a hostile string cannot become an identifier. Programmatic and agent callers may post the IR directly and skip the parser; humans get text. One compiler, one proof, two entrances.

The spike already demonstrates the shape: every identifier-bearing field derives from a developer-authored map via `z.enum(Object.keys(...))`, with no `z.record`, `z.any`, `z.unknown`, `.passthrough()` or `.catchall()` in the request schema. ClickHouse binds *values*; it never binds identifiers.

**3. v1 covers traces and spans, not traces alone.** `trace_summaries` is a rollup — no tool name, no per-step breakdown. A traces-only language would answer nothing the existing dashboards cannot already answer, shipping a query surface with no question worth asking. Spans cost a per-table tenant-scoping proof and raise the row-count ceiling; that is the price of the feature being useful. Evaluations, experiments and log records are deferred.

**4. One service, two transports.** A single entry point — `runLwqlQuery({ projectId, request, callerId })` — is called by both the REST route and the tRPC procedure; neither transport carries query logic. **Tenant scope is injected by the compiler from the RBAC-checked `projectId`, never read from the request body.** Read-only surfaces must be declared as queries: the spike declared its read path as a tRPC `.mutation()`, which is a defect to correct rather than a pattern to copy.

## Rationale / Trade-offs

The load-bearing choice is *allowlist-totality*: every dimension, metric and aggregation is a closed enum mapped to a developer-authored ClickHouse expression. This is what makes a user-supplied query language safe to expose at all, and it is why schema disclosure is cheap — knowing the table shape buys an attacker nothing when the identifier set is closed.

It also sets the cost: every new queryable column is a deliberate act. That is the intended trade. Starting restrictive and widening is reversible; starting permissive and narrowing is not, because by then the data has left. Where a question resolved asymmetrically, we resolved it toward the reversible direction.

We rejected a structured form/filter UI because it inverts the requirement: a form can only ask questions someone anticipated, and the point of this surface is the unanticipated question.

## Consequences

**A classification gap this ADR must close, and which predates it.** [ADR-028](./028-visibility-blur-teaser-redaction.md) gates *content* for out-of-window callers while stating in its own summary that "existence, timestamps, and **aggregates stay fully visible**." That was safe when aggregates meant fixed, developer-authored dashboard charts. It stops being safe once the **filter is caller-supplied**: a caller-controlled content-matching predicate composed with an unredacted aggregate can reveal gated content *without ever projecting it* — so a projection-only rule is satisfied while the data still leaves.

The consequence for LWQL is concrete: **filter reach and aggregate output must be classified on the same content-vs-metadata axis as projection.** Closing projection alone is insufficient. This is the one open question that blocks building rather than merely sequencing.

An equivalent composition is reachable in the platform today, outside this proposal. Specifics are deliberately not documented here and have been routed to the maintainer privately.

**Downstream:**

- ADR-028 needs an amendment from its owner: its aggregate carve-out predates any caller-supplied-filter aggregate surface. It is also still `Status: Proposed` while its service layer ships.
- Engine drift is already measurable between the two candidate read paths: the spike emits bare `arrayJoin(Models)` while the analytics builder emits `arrayJoin(if(empty(Models), ['unknown'], Models))`. Traces with no models are silently dropped by one and bucketed as `unknown` by the other — two different numbers for one question, before either has shipped. Whichever path hosts LWQL, this must be reconciled rather than inherited.
- A per-tenant rate limiter already exists (`TenantRateLimiter`, tiered, tested) but is wired only into the websocket broadcast path. A query surface should reuse it rather than ship unthrottled or invent a second one.

## Open questions — deliberately not decided here

This ADR is `Draft` because these are unresolved, and three of them were resolved once and then reopened under adversarial review:

1. **The classification axis** (above) — blocks implementation.
2. **Which engine hosts the compilation path** — the existing analytics engine (ADR-034/066/068 lineage) or the spike's compiler. **Time-bucketing is the deciding capability and must be settled first:** the spike has no time bucketing at all, while the analytics read path has timezone-aware bucketing across three tables. Deciding the engine before the bucketing question inverts the dependency. This also commits in-flight work on #5912 and so needs that work's owner.
3. **Synchronous vs async execution, and the v1 caps** — specifically whether a concurrency ceiling and a maximum queryable time-span are v1 gates or follow-ons.
4. **Whether `explain` (returning the generated SQL) is opt-in for all callers or internal-only.**

## References

- Issues: [#6346](https://github.com/langwatch/langwatch/issues/6346) (this work), [#5670](https://github.com/langwatch/langwatch/issues/5670) (spike), [#5389](https://github.com/langwatch/langwatch/issues/5389) (charting), [#5912](https://github.com/langwatch/langwatch/issues/5912) (analytics read path, in flight)
- PR: [#5709](https://github.com/langwatch/langwatch/pull/5709) (spike, unmerged draft)
- Related ADRs: [028](./028-visibility-blur-teaser-redaction.md), [034](./034-event-sourced-analytics-materialization.md), [066](./066-projection-clickhouse-cached-store.md), [068](./068-windowed-clickhouse-reads.md)
