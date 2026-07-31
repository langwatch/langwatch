# ADR-109: Storage — one table definition, three store kinds, one client

**Date:** 2026-07-30

**Status:** Accepted — supersedes ADR-099 and ADR-104. This is a consolidation
rather than a redesign: the storage layer survived the engine's deletion and
works. What changes is that one document now owns the table, the store and the
client, because a defect found while writing it lived in the seam between the
two it replaces.

**Supersedes:** ADR-099 (projection storage and `defineTable`), ADR-104 (the
ClickHouse client).

**Related:** ADR-107 (the members that mount these stores), ADR-108 (the
deliveries that write through them), ADR-103 (item rows and derived totals).

## Context

Two documents described storage. ADR-099 owned `defineTable`, the store kinds
and the row-level time roles; ADR-104 owned the single client, its retry policy
and its wire format. The split was reasonable and produced one live defect
class, which is the argument for merging them.

`defineTable` describes a table. The client rejects unknown columns
(`input_format_skip_unknown_fields: 0`) so that a typo cannot silently drop a
value. Those two facts are individually correct and jointly load-bearing: a
declaration that names a column the deployed table lacks is not a documentation
error, it is a write that throws on every attempt forever. Neither document said
so, because it is a statement about both.

That is not hypothetical. New declarations shipped with `AcceptedAt` on
`metric_series` and `metric_time_rollups`, which no migration adds; with `Steps`
and `MetricSeries` as `ch.json()` — a `String` — against deployed
`Array(Tuple(...))`; and with `stored_spans`, `trace_summaries` and
`trace_analytics` partitioned on a column that does not exist. The tests that
should have caught it asserted the declaration's own literals back at
themselves, under titles claiming migration parity, without reading a migration.

## Decision

### 1. A table is declared once, and the declaration is checked against the migration

`defineTable` is the single description of a table: columns and their types, the
merge strategy, the sort key, the partition expression, the tenant columns, and
any `structuralDebt` the table carries. Every read and write goes through it, so
a column's type is stated once and inferred everywhere — `TableRow<typeof
table.columns>` is the row type, never a hand-written interface beside it.

**A declaration is verified against the deployed DDL by a test that parses the
migration**, not by asserting its own literals. That is the only check that
could have caught the defects above, and it is the difference between a test that
documents the declaration and one that constrains it.

Deployed migrations are immutable. A sort key and a partition expression are not
alterable in place, so when a declaration disagrees with a deployed key the
default correct fix is to change the declaration — a re-key means a new table and
a copy, which is a migration with a rollout, not an edit.

### 2. Three store kinds, and the third is closed

| kind | engine behaviour | idempotent under redelivery |
| --- | --- | --- |
| `append` | keeps every row | yes when the sort key carries per-record identity, no for a plain `MergeTree` |
| `replace` | newest version by the version column wins | yes |
| `merge` | combines rows by sort key, additively | **no** |

A fold requires `replace`, because it reads its prior state back and only
`replace` offers that read. A map takes `append` or `merge`. `map` + `replace` is
refused: no executor accepts it and no adopter exists.

**`merge` is closed to new tables.** `AggregatingMergeTree` combines by sort key,
so the usual fix for non-idempotent redelivery — a per-write discriminator in the
key — stops two writes ever sharing a key and never combining, producing one row
per write: an append table wearing a rollup's name. The property that makes the
engine useful is the same property that makes a write identifier impossible. The
three tables that exist — `trace_analytics_rollup`,
`evaluation_analytics_rollup`, `gateway_budget_scope_totals` — are named debt,
and each leaves by one of two routes: a `replace` store written with the whole
bucket value, or derivation at read time.

### 3. Four row-level time roles, and a column may hold only one

- `occurredAt` — when the customer says it happened. Customer-supplied, so a
  skewed clock can win permanently; never order a fold on it.
- `acceptedAt` — when we took responsibility. Frozen for the row's life, so it
  cannot order anything.
- `lastAcceptedAt` — our boundary, on the latest applied event. This is what
  last-write-wins orders on.
- `writtenAt` — when this row version was written. The `replace` version column.

A partition expression and a `ReplacingMergeTree` version column must both be
platform-set and frozen. One moving column doing both jobs is a defect:
`experiment_run_items` has `OccurredAt` as version column *and* partition key,
and its re-key must fix that alongside the missing `ExperimentId` rather than
ship a fresh violation beside it (ADR-103).

A field whose write cadence needs tracking independently of the row's latest
applied event carries its own `asOf` column, distinct from these four.

### 4. One client, one wire format, and retryability follows the engine

There is one ClickHouse client. Reads use
`JSONCompactEachRowWithNamesAndTypes`; writes use `JSONCompactEachRow`. Both are
positional, so column names are not repeated per row — which is why the
throughput work in ADR-108 targets how many times a payload is serialised rather
than the format it is serialised into.

`input_format_skip_unknown_fields: 0` is deliberate: an undeclared column throws
rather than being dropped, which is what makes decision 1's parity test
meaningful.

**Only a write is ever retried.** A read is not, and neither is DDL. A read
corrupts nothing when repeated, so its refusal is not about duplicate safety: a
failed read has already consumed a slot in a pool of 25 behind a per-tenant
bulkhead, and re-issuing it holds that slot for up to three more request
timeouts while the condition that broke the connection is still in force — the
mechanism by which a brief ClickHouse blip becomes a queue of reads that
outlives it. A read also always has a caller waiting, and that caller is better
placed than the client to decide whether a narrower query, a cached answer or a
visible failure beats another thirty seconds. A write has no such caller; its
retry is the only thing between a transient blip and lost data. DDL is refused
because a repeated `CREATE`/`ALTER` is not idempotent and is not a decision this
client may take on its own — the migration runner owns it.

**Whether a write may be retried is then a property of the engine, not of the
caller.** A `replace` write is retryable — the version column resolves a
duplicate. An `append` write is retryable only when its sort key already carries
per-record identity, so a duplicate insert collapses at merge; a plain
`MergeTree` append is not, because a retry duplicates permanently. An
`aggregating` write is never retried, because a retry adds.

A durable write is never fire-and-forget. `insert` resolves only once the block
has landed, because ADR-107 decision 10 fixes the order as durable-store-first,
cache-second, and a fire-and-forget write breaks that ordering outright.

### 5. Every query is tenant-scoped and partition-bounded

`TenantId` is the first predicate of every read and every write. No other
identifier is unique across tenants, so a query keyed on a run id or a scenario
id alone is a cross-tenant read waiting for a collision.

Every read carries a bound on the partition column when a range is available.
Without one, ClickHouse scans every partition including cold storage, which
turns a 100ms query into seconds. A filter predicate that is not part of the sort
key is a row the engine is entitled to delete — so **every column a scoped read
filters on must be in the sort key.**

**A fold's read-back is a point read, and a time-leading sort key only permits
one behind a window.** A replace store refuses a sort key that does not begin
with its tenant and key columns, on the correct grounds that a read bound on
those alone would scan rather than seek. `coding_agent_sessions` is deployed
`ORDER BY (TenantId, StartedAt, SessionId)`, its own migration calling the key
time-leading, so a fold reading back by `(TenantId, SessionId)` cannot seek —
and the declaration matching that deployed key is what surfaced the conflict
rather than what caused it.

Both halves are right, which means the resolution is neither a looser guard nor
a wrong declaration. A read that also bounds the leading time column *is* a
seek, so a fold whose store is given a read window derived from the event may
mount on a time-leading key; one without a window may not. The guard therefore
tests the sort-key prefix against the tenant, the key columns **and** any
declared window column, and a store handed no window keeps the strict rule.

This is also why the windowed read is not an optimisation that can be dropped.
Removing it did not merely cost latency: it left every read-back on this class of
table scanning, which is the aggregate class behind a `TOO_MANY_PARTS` outage.
And a `ReplacingMergeTree` carrying a mutable time column in its key does not
collapse two versions of one row that disagree on it, so the eventual re-key onto
a key led by identity is a correctness fix, not tidying.

Reading the latest version of a deduplicated row uses the IN-tuple pattern —
`GROUP BY key` with `max(UpdatedAt)` in a subquery — not `LIMIT 1 BY`, which
materialises every selected column for whole granules and runs out of memory on
tables with heavy payload columns. Sort keys for cursor pagination come from
`argMax(column, UpdatedAt)`, never `max(column)`, which can take a value from a
stale version and make a cursor skip or repeat rows.

## Rationale / Trade-offs

**Why merge two accurate documents?** Because the defect class they permitted
lives between them: the consequence of a declaration naming an undeployed column
is a property of the client's strictness, and neither document could state it
alone. Merging is cheap here — this is a consolidation of working material, not
a redesign, and the combined document is shorter than either original plus the
cross-references it removes.

**Why parse the migration in a test rather than generate the declaration from
it?** Generation would drift silently when generation is skipped, and reviewing
generated output is reviewing an output. A parity test fails at the moment the
two disagree, which is exactly when a human should look.

**Why keep `structuralDebt` rather than fix the tables?** Because several fixes
are a new table and a copy, and an undeclared known-wrong column is worse than a
declared one: the declaration is where the next reader looks.

## Consequences

- **The declaration-versus-deployed defect class closes**, and the value-echo
  tests that hid it are replaced by parity tests that read migrations.
- **`merge` gains no fourth adopter**, and the three that exist have a stated
  exit.
- **Retryability stops being a caller's judgement** and becomes a fact about the
  store kind, so a batch's retry behaviour is decided where the engine is known.
- A re-key remains expensive. `experiment_run_items` needs one new table and one
  copy to fix both its missing `ExperimentId` and its double-duty `OccurredAt`.

## References

- `packages/clickhouse/src/schema/defineTable.ts`, `schema/columns.ts` — decision
  1 and 3.
- `packages/clickhouse/src/stores/` — decision 2.
- `packages/clickhouse/src/client/clickhouseClient.ts` — decision 4.
- `dev/docs/best_practices/clickhouse-queries.md` — decision 5's query patterns.
- `specs/event-sourcing/storage.feature` — the store kinds and the parity check.
- ADR-107, ADR-108, ADR-103.
