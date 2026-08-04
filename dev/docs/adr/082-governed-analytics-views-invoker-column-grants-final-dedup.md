# ADR-082: The governed `analytics.*` schema is invoker-rights views, column grants, and `FINAL`

**Date:** 2026-08-03

**Status:** Accepted

## Context

The governed analytics SQL API ([#6480](https://github.com/langwatch/langwatch/issues/6480))
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
table returned *both* tenants' rows to the restricted identity. A
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
its *outer* scope prunes: the `max()` subquery carries no predicate from the
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
*point lookups* dragging heavy columns through an on-the-fly merge; these views
scan partitions, where the merge is the cheap half.

**Captured content leaves the attribute maps and reappears as gated columns.**
Column grants cannot reach keys *inside* a `Map`, so each exposed map is filtered
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
  a caller who names the physical table directly reads that map *unfiltered*.
  Rows stay tenant-scoped (the policy is on the source), and the gateway's
  `allowedTables` is what keeps the physical name unwritable, but map-key content
  gating is enforced by the gateway rather than by the database. A `DEFINER` view
  whose definer itself carries a tenant row policy would close this and is
  explicitly rejected here — it trades a proven control (the caller's own row
  policy) for an unproven one.

- A source column referenced by its bare name inside a view body resolves to a
  *projection alias* of the same name, not to the table's column. The span view
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

## Alternatives considered

**`DEFINER` view with a policed definer.** Would let the caller hold no grant on
the physical tables at all, closing the map-key gap at the database layer. Not
taken: it depends on `getSetting()` resolving in the caller's session while
access resolves in the definer's, which is unmeasured, and it puts the model's
whole isolation guarantee on a mechanism whose *documented* behaviour is to
bypass row policies. Revisit only with a measurement, and only alongside the
audit that would catch a mis-provisioned definer.

**`argMax` aggregation in the view.** Deduplicates correctly, but forces a full
aggregation per query and only lets a caller's predicate through on the group
keys — strictly worse than `FINAL` on the axis that mattered.

**No deduplication, documented as "one row per version".** Rejected: it silently
doubles aggregates, which is the failure mode nobody notices.

## References

- `platform/app/src/server/analytics/governed-sql/catalog/` — the catalog and the
  content-gating derivation
- `platform/app/src/server/analytics/governed-sql/views.ts` — the generators, and
  the measurement on `SHIPPED_GOVERNED_DEDUP`
- `platform/app/src/server/analytics/governed-sql/__tests__/governedViews.integration.test.ts`
- `specs/analytics/governed-sql-api.feature`
- ADR-081 — the table-function and SSRF policy over the same identity
