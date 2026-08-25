# ADR-082: The LangWatchQL `analytics.*` schema is invoker-rights views, column grants, and `FINAL`

**Date:** 2026-08-03

**Status:** Accepted

## Context

The LangWatchQL analytics SQL API ([#6480](https://github.com/langwatch/langwatch/issues/6480))
lets an authenticated API client submit native ClickHouse SQL. It must run over
a **stable, curated namespace** rather than over the physical event-sourcing
projections, because those projections carry columns the API does not promise to
keep (`ProjectionId`, `LastProcessedEventId`), free-text carriers with no
visibility rule attached (`ErrorMessage`, `StatusMessage`), and captured customer
content that a caller may or may not be permitted to read.

The access model underneath — a shared restricted identity, `readonly = 1`, row
policies keyed on a per-query capability — is already settled and proven
(`provisioning.ts`, ADR-081). What was not settled is the shape of the exposed
objects. Three questions had to be answered against the deployed image, not from
first principles:

1. **Which view security mode?** ClickHouse views are `DEFINER` or `INVOKER`.
2. **What bounds the exposed columns?** The catalog is a list in TypeScript; a
   list is not an access control.
3. **How does a view deduplicate a `ReplacingMergeTree`?** Every source table
   carries multiple versions of a row until merges catch up, and the repository
   guidance (`dev/docs/best_practices/clickhouse-queries.md`) prescribes an
   `IN`-tuple over `(keys…, max(version))` — written for repository methods,
   which know the tenant and the key at the point the subquery is written.

## Decision

**Normal views, always `SQL SECURITY INVOKER`, never `MATERIALIZED`.** A
`DEFINER` view reads its sources as its definer, so the caller's row policies do
not apply to it — measured against 25.10.2.65, a `DEFINER` view over a policed
table returned _both_ tenants' rows to the restricted identity. A
`MATERIALIZED VIEW` defaults to `DEFINER`. Both are reported by
`definerViewAuditQuery`, which must stay empty.

**The row policy sits on the source table, not on the view.** An `INVOKER` view
reads its source as the caller, so the policy on the source bounds the view — and
bounds a direct read of the source in the same motion, which is what the
isolation proof needs. Policies apply `TO` the restricted identity only, so the
application's own reads and the migration path are untouched.

**Column-scoped grants on the source tables, generated from the catalog.** The
restricted identity holds `SELECT(<catalog columns>)` on each source table and
nothing more, so an off-catalog column is refused by the database with error 497
rather than merely omitted from a `SELECT` list. The catalog stops being a list
and becomes the exposed surface.

**Deduplicate with `FINAL`, not with the `IN`-tuple.** Measured against
`trace_summaries` holding 4,010 rows for two tenants across eight weekly
partitions, read as the restricted identity (`read_rows` from
`system.query_log`):

| strategy   | whole history | one week | rows returned |
| ---------- | ------------- | -------- | ------------- |
| none       | 4,010         | 508      | 2,004 (dupe)  |
| `IN`-tuple | 8,020         | 4,518    | 2,002         |
| `FINAL`    | 4,010         | 508      | 2,002         |

The `IN`-tuple view is pathological in a way the repository pattern is not. Only
its _outer_ scope prunes: the `max()` subquery carries no predicate from the
caller's query and has no way to receive one, so it reads the tenant's whole
history on every query — a one-week question costs more than reading the entire
table undeduplicated, and the gap widens linearly with retained history. Nor can
the fix be to push the caller's time range into the subquery: the partition key
is a business time a later fold can move, so a range inside the `max()` scope
reports an older version's stamp and the outer scope matches that older row —
stale data, no error, no gap.

`FINAL` costs exactly what no deduplication costs, prunes the full 8×, and is
correct across partitions (`do_not_merge_across_partitions_select_final` is 0 by
default; a version whose business time moved into a different week still
resolves to the newer row). The repository guidance against `FINAL` is about
_point lookups_ dragging heavy columns through an on-the-fly merge; these views
scan partitions, where the merge is the cheap half.

**Captured content leaves the attribute maps and reappears as gated columns.**
Column grants cannot reach keys _inside_ a `Map`, so each exposed map is filtered
with `mapFilter` against the content keys the data-privacy policy already
defines (`CONTENT_KEY_CATALOG`), plus their exploded forms (`gen_ai.prompt.` for
`gen_ai.prompt.0.content`). Content is then re-exposed only as dedicated columns
carrying the gate that governs them — `input` / `output` / `costs`, the same
three the trace read path collapses `Protections` onto. The gated set the AST
validator receives is derived from the catalog and the caller's `Protections`,
never hand-listed.

## Consequences

- The exposed surface is one artifact. Adding a column to the API means adding a
  catalog entry; the grant, the view body, the schema endpoint's types and the
  validator's allowlist all follow. Forgetting to gate a column built over a
  content key fails a unit test whose expectation comes from the data-privacy
  module rather than from the catalog.

- **The physical tables stay readable by the restricted identity, within its
  catalog columns and its tenant.** This is structural, not an oversight: an
  `INVOKER` view only works if the caller holds grants on every source column the
  body reads, so `SELECT(SpanAttributes)` on the span table is unavoidable — and
  a caller who names the physical table directly reads that map _unfiltered_.
  Rows stay tenant-scoped (the policy is on the source), and the gateway's
  `allowedTables` is what keeps the physical name unwritable, but map-key content
  gating is enforced by the gateway rather than by the database. A `DEFINER` view
  whose definer itself carries a tenant row policy would close this and is
  explicitly rejected here — it trades a proven control (the caller's own row
  policy) for an unproven one.

- A source column referenced by its bare name inside a view body resolves to a
  _projection alias_ of the same name, not to the table's column. The span view
  exposes a filtered `SpanAttributes` and reads captured input out of the
  unfiltered one; written bare, the second reference picked up the first's alias
  and the content-gated column came back empty for every span while every other
  assertion passed. The generator therefore passes a qualifier into every column
  expression rather than trusting the author to remember one.

- Free-text carriers with no rule in the visibility policy — `ErrorMessage`,
  `Error`, `ErrorDetails`, `StatusMessage`, the `Events.*` nested group — are
  off-catalog and therefore unreachable. Exposing them would mean inventing a
  gate rather than deriving one. `Status` and `ContainsErrorStatus` carry the
  analytic signal.

- These objects are provisioning statements, not goose migrations. Deployment
  wiring is a later slice of #6480.

## Amendment: aggregating sources, moving sort keys, and what a grain is (2026-08-11, #6856)

Exposing the modern analytics projections
([#6856](https://github.com/langwatch/langwatch/issues/6856)) brought the first
source tables that are **not** `ReplacingMergeTree`s: `trace_analytics_rollup`
and `evaluation_analytics_rollup` are `AggregatingMergeTree`s, whose rows for one
sort key are _summed_ rather than one superseding the others.

The decision above holds for them: `FINAL` is what those views use, except
where the published grain is narrower than the source key — see the `GROUP BY`
render below. Measured
against 25.10.2.65 with merges stopped and a bucket written as two parts, `FINAL`
over an `AggregatingMergeTree` returns one row per sort key with each
`SimpleAggregateFunction(sum, …)` column summed across the parts. What changes is
what the catalog has to _say_, and — for one dataset — which strategy it uses.

**A catalog entry declares an aggregating source explicitly**
(`LangWatchQLViewDedup.aggregating`), and such an entry declares no version column.
Absence of a version column previously meant one thing — a PostgreSQL-resident
view with nothing to collapse — and the unit guard read it that way, so an
aggregating entry would otherwise be indistinguishable from a `ReplacingMergeTree`
entry that forgot to name its version. `dedupPredicate` and the guard now branch
on the flag rather than on the absence.

**The key columns are the source's whole `ORDER BY`, and an integration case now
enforces it** against `system.tables.sorting_key` and `engine`. Stating the rule
was not enough: under the shipped `final` strategy the engine collapses on the
table's own `ORDER BY` and on nothing an entry says, so a wrong declaration does
not change a single returned number — it changes the _diagnostic_, which then
describes a grain the engine is not using and reports fan-out on joins that do
not fan out (or stays silent on ones that do). The rule is true by construction
now rather than by review.

**The grain is a separate declaration from the sort key**
(`LangWatchQLViewDefinition.grainColumns`) — but only where the strategy can
deliver the narrower grain. `evaluation_metrics` declares
`(TenantId, EvaluationId)` against a sort key of
`(TenantId, OccurredAt, EvaluationId)`: its `in-tuple` dedup groups by the
grain, so the view really does return one row per evaluation, and the fanout
diagnostic reads the same declaration the view collapses on. `trace_metrics`
deliberately does **not** declare one, although it too is one row per trace for
every row the current fold writes: it deduplicates with `FINAL`, which merges on
the engine's sort key `(TenantId, OccurredAt, TraceId)` and nothing narrower, so
a pre-freeze row whose `OccurredAt` moved (migration 00061, ADR-071) comes back
as two rows. Declaring `(TenantId, TraceId)` there would publish a grain the
engine cannot deliver; the diagnostic honestly reporting `OccurredAt` unmatched
is the price of not overstating it. A catalog invariant enforces the rule:
a grain narrower than `keyColumns` requires a strategy that groups —
`in-tuple`, or the aggregating `GROUP BY` render below.

**An aggregating source whose published grain is narrower than its key renders
as `GROUP BY`, not `FINAL`.** `trace_metrics_by_minute` publishes
`(TenantId, BucketStart)` over a rollup keyed
`(TenantId, BucketStart, Model, SpanType)`: half its measures are trace facts
(`TraceCount`, `ErrorCount`, `DurationSum`) that a per-model breakdown would
misstate, so the view groups the breakdown away — `GROUP BY` the grain, every
measure as `to<type>(sum(…))`, no `FINAL`, since the aggregation subsumes the
merge. A column of such a view that is neither grain nor a summed measure is a
provisioning error rather than an arbitrary value. The per-model breakdown is
its own dataset, `model_usage_by_minute`, at the full key with span-fact
measures only. This does not reopen the `argMax` rejection below: that was
aggregation as a _dedup_ device on a detail dataset, where the group keys are
the sort key and a caller's predicates on anything else stop pruning. Here the
group keys are the published grain of a rollup — `TenantId` and the partition
column `BucketStart` — which is exactly where a caller's predicates already go.

**`evaluation_metrics` pins the `in-tuple` strategy** (`LangWatchQLViewDedup
.strategy`), the one entry in the catalog that does not take the measured
default. `evaluation_analytics` folds its progress watermark —
`max(previous, event time)` — straight into `OccurredAt`, which is second in its
sort key, so two lifecycle versions of one evaluation are two _keys_: `FINAL`
merges neither into the other and returns both. That is not a visible duplicate;
it is every `count`, `sum` and `avg` a caller writes over the dataset silently
counting the evaluation once per version. The owning repository refuses `FINAL`
on this table for the same reason. The cost is the one the measurement above
found — the `max()` subquery carries no predicate from the caller's query, so it
reads the tenant's whole evaluation history per query — and it is paid on this
dataset only, rather than by moving the default onto tables whose sort keys hold
still. That cost is an **accepted risk, not a solved one**: it grows linearly
with retained history under the query-time cap, and the row count at which a
tenant's queries start hitting that cap is unmeasured. Measuring the crossover
is a filed follow-up, not a blocker here. The residual is a tie: two writers that stamp the same `UpdatedAt` both
satisfy the `IN`, and a view has no per-key `LIMIT 1` to rank them, so such a pair
returns two rows — rare, and visible as a duplicate rather than as a plausible
number.

**Rollup measures declare `summed` and the cast is derived from it**
(`to<published type>` over the column's own source column). A view that passes
such a column straight through reports it to `system.columns`, and therefore to
the schema endpoint, as `SimpleAggregateFunction(sum, UInt64)` — the name of a
storage engine where a caller expects the type of a number. The merge has run by
the time the projection does, so the cast reads the merged total. The cast is
derived rather than written because a hand-written one restates the column's name
and its type beside it: a copy-paste leaving `TraceCount` reading `SpanCount`
type-checks, returns a number, and passes any fixture whose measures share a
value. The merge fixture now gives every measure a distinct value and total, so
that second guard can disagree with the first.

Two datasets now answer "how many traces" (`traces` and `trace_metrics`), and two
answer it for evaluations. That is deliberate and is not two sources of truth:
both are folded from the same events by the same services, and the catalog
descriptions say which is shaped for which question. The rollups' `TraceCount`
is the one number that genuinely differs — it counts a trace through its root
span, so a trace whose root span never arrived contributes sums and no count,
which the column description states.

## Alternatives considered

**`DEFINER` view with a policed definer.** Would let the caller hold no grant on
the physical tables at all, closing the map-key gap at the database layer. Not
taken: it depends on `getSetting()` resolving in the caller's session while
access resolves in the definer's, which is unmeasured, and it puts the model's
whole isolation guarantee on a mechanism whose _documented_ behaviour is to
bypass row policies. Revisit only with a measurement, and only alongside the
audit that would catch a mis-provisioned definer.

**`argMax` aggregation in the view.** Deduplicates correctly, but forces a full
aggregation per query and only lets a caller's predicate through on the group
keys — strictly worse than `FINAL` on the axis that mattered.

**No deduplication, documented as "one row per version".** Rejected: it silently
doubles aggregates, which is the failure mode nobody notices.

## References

- `platform/app/src/server/analytics/lwql/catalog/` — the catalog and the
  content-gating derivation
- `platform/app/src/server/analytics/lwql/views.ts` — the generators, and
  the measurement on `SHIPPED_LWQL_DEDUP`
- `platform/app/src/server/analytics/lwql/__tests__/lwqlViews.integration.test.ts`
- `specs/analytics/lwql-api.feature`
- ADR-081 — the table-function and SSRF policy over the same identity
