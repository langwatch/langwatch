# ADR-084: PostgreSQL-resident data is reached through an approved view, a policed engine table, and a view-carried tenant predicate

**Date:** 2026-08-04

**Status:** Accepted

**Relates to:** [ADR-081](./081-governed-sql-table-function-and-ssrf-policy.md) (why the caller can never write `postgresql()` themselves), [ADR-082](./082-governed-analytics-views-invoker-column-grants-final-dedup.md) (the invoker-view and column-grant model this extends across a second residence).

Behavioural contract: [specs/analytics/governed-sql-api.feature](../../../specs/analytics/governed-sql-api.feature).

## Context

The governed analytics SQL API ([#6480](https://github.com/langwatch/langwatch/issues/6480))
answers questions over ClickHouse. Three of the question classes it exists to
answer cannot be answered there at all, because the data lives in the
application's PostgreSQL: human annotations, experiments and their runs, and the
project and prompt names a cost report is supposed to print instead of
identifiers.

The issue settles the mechanism: one mapping, not two — live PostgreSQL-engine
tables in ClickHouse over a server-side named collection, with projection as a
documented per-table fallback if a table fails a measured bar. It also states
the risk plainly: there is no PostgreSQL read replica, so the named collection
points at the primary OLTP database, and the role's limits are the only
containment.

That containment turned out to be weaker than the design assumed, and the gap is
what this ADR is mostly about.

**Measured against `clickhouse/clickhouse-server:25.10.2.65`, a row policy's
predicate is never pushed down to PostgreSQL.** Not in the key-map form the
model uses, and not as a constant `TenantId = 'x'` either. Every shape emits

```sql
COPY (SELECT "id", "TenantId" FROM "approved_view") TO STDOUT
```

and filters inside ClickHouse afterwards. So tenant isolation held — a garbage
key still returned zero rows — while load containment did not: any authenticated
caller could make the primary full-scan a mapped table, including on a read that
was about to return nothing.

Two mechanisms were measured and rejected before the one below:

- **`additional_table_filters`, sent as a per-query setting.** It does not push
  down (the filter is applied inside ClickHouse, exactly like the policy), and
  it *breaks* any query that does not already read the tenant column, with
  `NOT_FOUND_COLUMN_IN_BLOCK`. Worse on both counts.
- **Rewriting the caller's SQL at the gateway to add the predicate.** This
  works, and it is forbidden: `Scenario: Submitted SQL is never automatically
  rewritten` is a bound scope guard for this issue, and its test asserts that
  the statement in `system.query_log` is the submitted one with nothing but
  `FORMAT JSON` appended.

## Decision

A PostgreSQL-resident dataset is one catalog entry carrying a
`GovernedPostgresMapping`, and that entry generates the whole chain. Four
objects, each with one job:

1. **An approved PostgreSQL view** over the application's table, exposing
   exactly the catalog's columns under the catalog's names — including renaming
   `projectId` (and, on `Project`, `id`) to `TenantId`. The dedicated reader role
   holds `SELECT` on these views and on nothing else, so a column the catalog
   does not expose is unreachable rather than merely unselected.
2. **A PostgreSQL-engine table** in the governed database, mapping that view
   through the named collection. The **row policy sits here**, and it is what
   makes the mapping safe.
3. **A governed invoker-rights view** over the engine table — the object a
   caller names, and the object carrying the tenant predicate below.
4. **The dedicated role**, non-owner, `default_transaction_read_only = on`, with
   a `statement_timeout` and a `CONNECTION LIMIT`.

**We will carry the tenant predicate in the governed view's own body**, as a
scalar subquery over the self-policed key map:

```sql
WHERE src.`TenantId` = (SELECT km.`TenantId` FROM analytics.api_key_tenants AS km)
```

A scalar subquery is the one shape that pushes down: ClickHouse folds it to a
constant before it plans the PostgreSQL read, then sends that constant. The
`IN (subquery)` form the row policy uses stays a set and is applied after the
read, which is precisely why the policy does not contain load. The subquery needs
no `WHERE` of its own because the key map polices itself — the restricted
identity sees exactly the row its own hash matches — so it yields this caller's
tenant, and an unknown or empty key yields no row, which folds to `NULL` and
matches nothing in PostgreSQL.

Nothing about the caller's statement changes. The predicate lives in a
server-side view definition, which is where every other governed view's body
already lives, so the `never rewritten` guard is untouched.

## Rationale / Trade-offs

**The predicate is a performance control and must never be mistaken for a second
security boundary.** The row policy on the engine table underneath still decides
the answer, so getting the predicate wrong costs a wrong *read* and never a wrong
*result*. This is proven rather than argued: with a view's predicate hard-coded
to a foreign tenant, PostgreSQL demonstrably received `WHERE "TenantId" =
'tenant-b'` and really did read those rows, and the caller received zero. That
split — isolation assertions green while the load assertion moves — is what
makes the claim falsifiable rather than a slogan.

Measured against the objects the shipped generators provision, over a
10,016-row annotation table across 42 tenants where the asking tenant owns two,
from PostgreSQL's own `pg_stat_user_tables` accounting:

| read                                    | rows returned | rows PostgreSQL read | statement PostgreSQL received |
| --------------------------------------- | ------------- | -------------------- | ----------------------------- |
| engine table, policy only               | 2             | 10,016               | no `WHERE` |
| governed view, valid key                | 2             | 2                    | `WHERE "TenantId" = 'tenant-a'` |
| governed view, unknown key              | 0             | 0                    | `WHERE "TenantId" = NULL` |
| governed view, foreign-tenant predicate | 0             | >0 (the foreign rows)| `WHERE "TenantId" = 'tenant-b'` |

Five thousand fold on this fixture, and the ratio is the tenant's share of the
table — which is the point: the cost stops scaling with how many *other*
tenants exist. The unknown-key row is the one worth noticing beyond that: the
shape that returns nothing used to cost a full scan of the primary.

**What is compromised.** The predicate's correctness now depends on the key map's
self-policy, which was previously load-bearing only for the key map itself. If
that policy were missing, the subquery would see every row and fail as a
multi-row scalar — a broken query rather than a leak, which is the right failure
direction, but it is a new coupling and `governedPolicyCoverageQuery` auditing
that policy now matters here too.

**Why the approved views are generated, not migrated.** Their column lists are
the governed catalog's, they change when the catalog changes, and nothing the
application itself reads touches them. Binding them to Prisma's migration history
would tie a catalog edit to a schema migration and leave the two able to
disagree. They are emitted as DDL from the catalog, like every other object in
this module.

## Consequences

- Six datasets join the catalog — `annotations`, `experiments`,
  `experiment_runs`, `projects`, `prompts`, `prompt_versions` — and the three
  blocked question classes become answerable. Models are already names on the
  fact tables, so no dimension is mapped to resolve one.
- The catalog now spans two residences behind one list. Every consumer — schema
  endpoint, validator, diagnostics — reads that list unchanged; only the
  provisioning generators ask which residence an entry has, and they ask the
  entry rather than being told.
- `GovernedViewDedup.versionColumn` becomes optional, meaning "the source keeps
  one row per key and there is nothing to collapse". `keyColumns` is the grain
  either way, which is what the fanout diagnostic reads — so an
  annotations-to-traces join earns a correct fanout warning with nothing written
  for it.
- `traces.HasAnnotation` is **no longer exposed**. It is folded from a
  best-effort dual-write while `annotations` reads PostgreSQL directly;
  publishing both would let one caller ask the same question two ways and get
  two answers with nothing saying which is authoritative. The underlying
  `trace_summaries.AnnotationIds` column stays — the product's has-annotation
  filter reads it — so this removes the second *source*, not the projection. The
  projection's own end state remains open.
- No table has failed the measured bar, so **no projection fallback is built**,
  per the issue's instruction not to build one speculatively.
- Deployment wiring is still absent, for this and for everything else in the
  module: no code path outside the Testcontainers harness applies any of this
  DDL, and the named collection's credentials, the approved views' creation and
  the key map's population all need a home.

## Alternatives considered

**Leave the load gap and reach for the projection fallback.** The issue names
annotations as the table most likely to need it. But the fallback is a
periodic-sync or dual-write pipeline with its own staleness and backfill, and the
measurements above show the live mapping reading exactly the caller's rows — so
building one now would be speculative work against a bar no table failed.

**Put the pushdown predicate in the row policy, in scalar form.** Measured: a
row policy's predicate does not push down in *any* form, scalar included. The
policy is applied after the read regardless.

**Send the tenant as a second custom setting and reference it in the view.** The
view would then read `getSetting('custom_tenant_id')` rather than the key map.
Rejected: it puts a *tenant id* on the wire where today only an opaque key hash
travels, and the key map already resolves the same fact server-side with a policy
proving it cannot be probed.

## References

- Issue: [#6480](https://github.com/langwatch/langwatch/issues/6480)
- `platform/app/src/server/analytics/governed-sql/catalog/postgresViews.ts` — the six entries
- `platform/app/src/server/analytics/governed-sql/views.ts` — `postgresTenantPredicate`
- `platform/app/src/server/analytics/governed-sql/provisioning.ts` — approved views, engine tables, reader role
- `platform/app/src/server/analytics/governed-sql/__tests__/postgresEngineIsolation.integration.test.ts` — the proof and the measurements
