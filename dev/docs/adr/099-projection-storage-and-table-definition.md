# ADR-099: Projection storage — three store kinds and one table definition

**Date:** 2026-07-29

**Status:** Superseded by [ADR-109](./109-storage.md) (2026-07-30). Previously: Accepted

**Related:** ADR-098 (the two projection kinds this storage layer serves, and the
write ordering it must honour), ADR-100 (the dispatch plane that decides what a
batch contains before it reaches a store), ADR-104 (the client, whose retry
policy is decided by the merge strategy declared here).

## A store kind is what the engine does with two rows sharing a key

A projection says whether it reads prior state. A store says what happens when
two rows collide. Those are separate questions, and the second one has exactly
three answers:

- **`append`** — both rows survive. `MergeTree`, or a `ReplacingMergeTree` whose
  sort key already carries a per-record identity.
- **`replace`** — the newest wins. `ReplacingMergeTree` with a version column
  that genuinely orders versions, or a row in Postgres.
- **`merge`** — the engine combines them. `AggregatingMergeTree`.

Crossed with the two projection kinds from ADR-098, four combinations are in use
and one of them is dangerous:

| projection | store | example | idempotent on redelivery |
| --- | --- | --- | --- |
| `map` | `append` | span storage | yes |
| `map` | `merge` | the analytics rollups | **no — the engine adds** |
| `fold` | `replace` | trace summary, coding-agent session | yes |
| `fold` | `replace` (Postgres) | Langy conversation state | yes |

`map` + `merge` is the only cell in that grid where delivering the same event
twice changes the answer, and it is invisible at the call site today: the
projection is registered as a map, and the fact that its table adds rather than
replaces lives in a migration three directories away. A store kind is therefore
declared on the table, and the combination is checked where the projection is
mounted.

A `merge` store is only correct when the combination is genuinely commutative and
associative — sums, counts, minima, maxima, `uniq`. Three events that fill in
different fields of one row cannot be combined without knowing which came first,
so that is a `fold` with a `replace` store however few event types it subscribes
to.

### Every row carries an idempotency key, and `merge` is closed because it cannot

A repeated write must collapse. For `append` that is a column: put an
idempotency key in the sort key and a duplicate insert resolves to one row, the
same way a `replace` table resolves to its newest version. Making it universal
removes a special case rather than adding a feature — ADR-104's retry policy no
longer needs to ask whether a particular append table happens to carry a
per-record identity, because every one does.

`merge` cannot have it. `AggregatingMergeTree` combines rows *by the sort key*,
so a per-write identifier in that key means two writes no longer share a key and
never combine. What survives is one row per write — an append table with a
rollup's name. The property that makes the engine worth using is the same
property that makes a write identifier impossible, so this is not a gap to be
closed.

**`merge` is therefore closed to new tables.** Three exist, and each leaves by
one of two routes:

| table | exit |
| --- | --- |
| `trace_analytics_rollup` | derive at read time, or `replace` written with the whole bucket |
| `evaluation_analytics_rollup` | same |
| `gateway_budget_scope_totals` | needs measuring first — it gates spend, so it is read hot, and a read-time sum over `gateway_budget_ledger_events` is a range scan on a key that leads with `(TenantId, BudgetId)`. Plausible, unproven |

Both routes make the write idempotent by the same mechanism as everything else:
a key that identifies the row, and a version that orders two writes to it. The
cost is that a whole-bucket write must know the whole bucket, which means
reading it back — so a rollup that leaves this way becomes a `fold`, not a `map`.
That is the honest shape of the work, and it is why these are debt with an exit
rather than a migration anyone can do in an afternoon.

## Context

A ClickHouse table's engine decides what a correct read looks like, and nothing
in this codebase connects the two.

`ReplacingMergeTree` collapses versions only within a partition and only at
merge time, so every read has to dedup or it returns stale rows.
`AggregatingMergeTree` combines rows on merge, so every write has to be
exactly-once or it double counts. `MergeTree` needs neither. Those are three
incompatible contracts and they are currently expressed the same way: a
hand-written SQL string in a repository, reviewed by whoever remembers the rule.

Today the metadata to do better already exists and is inert:

- `src/server/clickhouse/schema-catalogue.ts` describes all 33 tables —
  partition expression, partition column, sort key, version column, tenant
  columns, heavy columns, and a hand-asserted `partitionColumnStability`. A
  drift test pins it to the migrations that create the tables.
- `convention-gate.ts:145` iterates the catalogue to police tenant and partition
  predicates at runtime.
- But all four accessors — `partitionColumnOf`, `tenantColumnsOf`,
  `versionColumnOf`, `partitionColumnMayMove` — have **zero callers repo-wide**.
  `partitionColumnMayMove` (`schema-catalogue.ts:647`) is declared and never
  invoked.
- And `partitionColumnStability`, the field encoding the single most dangerous
  property in the schema, is read only by the drift test, which asserts that it
  is *documented*. No runtime rule consults it.

The cost of that gap is visible in the tree. `dedupedSlim()` in
`eval-slim-timeseries-query.ts` is a byte-identical copy of the helper in
`slim-timeseries-query.ts`. The original is correct because `trace_analytics`
has a frozen partition column. The copy is wrong because
`evaluation_analytics.OccurredAt` moves — migration 00041 stamps it from the
latest event — so bounding the dedup subquery on it drops the true latest
version out of its own `GROUP BY` group and returns a stale row that is
non-null and plausible. The copy inherited an assumption that the comment three
files away had recorded and the type system could not.

The wire format compounds it. Every read is `format: "JSONEachRow"`, which
re-sends every column name on every row and returns loosely-typed JSON.
`src/server/clickhouse/recordDecode.ts` exists only to absorb the consequences,
and says so:

> ClickHouse serialises a `JSONEachRow` result as loosely-typed JSON: Int64 /
> UInt64 columns come back as strings (a JSON number can't round-trip past
> 2^53), Float64 columns as numbers, Array / Map columns as themselves, and an
> absent column is simply missing from the object.

It has three call sites. Every other repository hand-writes its own `fromRecord`
mapper, so the row type, the decode, and the column list are declared three
times per table and drift independently.

## Decision

One `defineTable` call per table is the single source of truth for its shape,
its codec, and the query API it exposes.

```ts
export const traceAnalytics = defineTable({
  name: "trace_analytics",
  merge: replacing({ version: "UpdatedAt" }),
  sortKey: ["TenantId", "AcceptedAt", "TraceId"],
  partition: { by: "toYearWeek(AcceptedAt)", column: "AcceptedAt", stability: "frozen" },
  tenant: ["TenantId"],
  ttl: { anchor: "AcceptedAt" },
  columns: {
    TenantId:    ch.string(),
    OccurredAt:  ch.occurredAt(),
    AcceptedAt:  ch.acceptedAt(),
    UpdatedAt:   ch.dateTime64(3),
    TotalCost:   ch.float64(),
    InputTokens: ch.uint64(),
    Attributes:  ch.map(ch.string(), ch.string()),
  },
});
```

The partition key, the TTL anchor and the sort key's time column are all
`AcceptedAt` — the frozen, platform-set column — never `OccurredAt`. `OccurredAt`
still belongs on the row: it is what domain display and analytics bucketing read.
The two columns coexist by design; only one of them may carry structure.

### The merge strategy selects the query API

`merge` is a discriminated union, and it changes which methods exist. This is
the whole point: the engine contract becomes a type error rather than a
convention.

| `merge` | reads | writes |
| --- | --- | --- |
| `replacing({ version })` | `.select()` dedups by default; `.raw()` exists but must be written out | plain insert, retry-safe |
| `aggregating()` | no raw `.select()` — only `.merge()`, which emits `-Merge` combinators | requires `-State` values **and** a declared idempotency story |
| `append()` | no dedup method at all; asking for one does not compile | plain insert |

A `map` projection writing to an `aggregating` table is the only combination in
the system that double counts on redelivery. Under this decision it is the only
combination that must name how it avoids doing so.

### Four time roles, and only one of them may carry structure

More than 20 distinct time-column names exist across the 33 tables —
`EventTimestamp`, `EventOccurredAt`, `OccurredAt`, `StartTime`, `EndTime`,
`StartedAt`, `ScheduledAt`, `UpdatedAt`, `LastUpdatedAt`, `LastEventOccurredAt`,
`CreatedAt`, `ProjectedAt`, `IngestedAt`, `AcceptedAt`, `LastSeenAt`, `AsOf`,
`TimeUnixMs`, `BucketStart`, `PeriodStart`, `HourBucket`, `DedupVersion`,
`inserted_at`, `created_at`. No reader can hold that in their head, which is why
the same class of mistake keeps landing. There are 4 roles:

| role | who sets it | moves? | may be used for |
| --- | --- | --- | --- |
| `occurredAt` | the **customer's process** | yes | domain display, analytics bucketing |
| `acceptedAt` | our ingest boundary, on the **anchoring** event | **never** | partition key, TTL anchor, dedup-subquery bounds |
| `lastAcceptedAt` | our boundary, on the **latest applied** event | yes | last-write-wins ordering |
| `writtenAt` | the projection, on every write | yes | the `ReplacingMergeTree` version column |

The prohibitions are the useful half. **`occurredAt` may never be a partition
key, a TTL anchor, a version column, or a last-write-wins ordering key.** Row-level
last-write-wins — which of two whole rows is newer — orders on `lastAcceptedAt`,
never `acceptedAt`: `acceptedAt` is frozen for the row's life, and a frozen
column cannot order anything.

`AsOf` in the list above is not one of the 4 roles and is not abolished by this
decision. A *field-level* LWW stamp — which of two values for one column is
newer, independent of when the row as a whole was last touched — is a separate
`asOf` column scoped to that field. It is distinct from `lastAcceptedAt`, which
orders the row, and tables that merge fields from independent event streams keep
it.

A fold row aggregates many events, so accept time is ambiguous and the split
matters: `acceptedAt` is the *first* event's, frozen for the row's life;
`lastAcceptedAt` moves with the latest applied event. Collapse them and the
moving-partition-column defect returns under a better name.

### A structural column must be frozen *and* platform-controlled

Stability alone is not sufficient, and `event_log` is the proof. Its partition
column is marked `frozen` with a rationale that is correct — an event row is
immutable, and the sort key ends in `IdempotencyKey`, so a replay rewrites the
same row rather than moving it. Yet it partitions and expires on a value the
customer supplies:

```sql
PARTITION BY toYearWeek(toDateTime64(EventOccurredAt / 1000, 3))
EventOccurredAt UInt64 DEFAULT 0
```

with `ttlColumn: "EventOccurredAt"` in the reconciler at 49 days, while
`CreatedAt DateTime64(3) DEFAULT now64(3)` — our own clock, already in the table
— carries nothing. Three consequences follow, on the highest-volume table in the
system:

- **Part count becomes an untrusted input.** ClickHouse creates at least one part
  per distinct partition value per flush, so a skewed producer clock or a
  backfill of old telemetry scatters inserts across distant week partitions.
- **Retention becomes customer-controlled.** A future-stamped event outlives its
  49 days; a backdated one expires early.
- **`DEFAULT 0` is immediate expiry.** An event arriving without `occurredAt`
  lands in the 1970 partition, already 56 years past the TTL, in the table that
  is the system's source of truth.

So a partition key, a TTL anchor and a dedup-subquery bound must satisfy both
tests: **frozen for the row's life**, and **set by the platform**. Of the 4
roles only `acceptedAt` satisfies both, which is why re-keying targets platform
accept time.

`defineTable` enforces this rather than documenting it. The column builders
carry their role, `partition.column` and `ttl.anchor` accept only a frozen
platform-set role, and `ch.occurredAt()` is structurally ineligible for either.
Existing tables declare a role mapping (`acceptedAt: "StartedAt"`) so the rules
apply to today's column names; the canonical names are used by new tables and by
any table being re-keyed anyway.

### A deployed table that breaks the rule declares the debt, rather than lying about the role

The rule above is correct and the tables that break it are already deployed, so
for a while there was no way to declare them at all. What happened next is the
part worth recording: three separate migrations each mislabelled a column to get
past the guard — a customer-supplied instant declared `acceptedAt`, a
business-time version declared `writtenAt`, a plain `DateTime` borrowing a role
it does not have. Each declaration compiled, each said something false, and the
guard was silently disarmed for exactly the tables that needed it most.

A binary guard against an immutable schema does not produce compliance. It
produces a lie at the point of least resistance, and the lie is invisible
afterwards.

So a table may name a column and a reason:

```ts
structuralDebt: [{ column: "EventOccurredAt", reason: "…" }]
```

The column then declares its **true** role, and only that column, on that table,
is spared. Everything else stays armed. Three properties keep it from becoming a
general escape hatch, and all three are checked at construction: a `reason` is
required and may not be blank; an exemption naming an undeclared column or the
same column twice fails; and an exemption for a column that is not actually the
table's partition column, TTL anchor or replacing version is refused as
**unused** — so one cannot be pre-staged, and it can only exist where a deployed
constraint genuinely forces it.

This is the shape decision "merge is closed" already uses: named adopters, a
stated reason, no open-ended allowlist. It changes nothing on the wire. The
declaration stops asserting something untrue, which means the debt list below is
now greppable from the code rather than maintained by hand.

### Partition-column stability decides where a predicate may go

`stability: "frozen"` puts the time predicate on both the outer scope and the
dedup subquery — it prunes and it is safe. `stability: "movable"` allows it on
the outer scope only; the builder refuses to place it inside a dedup subquery.
The `dedupedSlim` clone above would not compile against `evaluation_analytics`.

`unverified` is a build error, not a default. A table whose partition column
nobody has reasoned about does not get a query builder.

### The codec is positional and compiled

Reads use `JSONCompactEachRowWithNamesAndTypes`; writes use
`JSONCompactEachRow`. Rows arrive as arrays rather than objects, so column names
cross the wire once per result instead of once per row, and decoding is index
arithmetic instead of key lookup.

`RowBinary` and `Native` are **not supported by `@clickhouse/client`** — the
installed `SupportedJSONFormats` and `SupportedRawFormats` lists in
`node_modules/@clickhouse/client` contain neither, and upstream documents
RowBinary as planned. The wire codec therefore sits behind an interface with one
implementation today, so adopting RowBinary later changes one file.

Each `ch.*` column builder carries three things: the ClickHouse type name for
DDL cross-checking, a zod schema whose decode is a **sync** transform, and an
encode function. Sync transforms compile under `zod-compiler`, so the hot path
runs generated code rather than zod's interpreter. `ch.uint64()` decodes to
`bigint`, because the client sends 64-bit integers as strings precisely because
they do not fit a double.

From the one definition:

- `z.infer<typeof traceAnalytics.row>` is the row type. Repositories stop
  declaring their own.
- `decodeRow(cells: unknown[]) => Row` and `encodeRow(row) => unknown[]` are
  generated and positional. This retires `recordDecode.ts` and every
  hand-written `fromRecord`.
- The `WithNamesAndTypes` header is compared against the declared columns on
  first use per table per process. A column whose type changed in a migration
  raises a loud error instead of silently coercing wrong. This is a runtime
  drift check that parsing migration files cannot perform.

### Reads are buffered by default, streamed on request

`ResultSet.stream()` holds the response stream — and therefore a connection —
open until consumed, and `max_open_connections` defaults to `10`. A fold
read-back is a single row by key; streaming it would tie up a tenth of the pool
for the duration of the fold. `.one()` and `.rows()` buffer. `.stream()` is
explicit and documented for large scans, exports and backfills.

### Writes batch client-side, with async insert as a second line

The projection layer already coalesces per group, so batches exist before they
reach this layer. Inserts carry `async_insert: 1` and
`wait_for_async_insert: 1`.

`wait_for_async_insert: 0` is prohibited. It acknowledges before the data is
durable, which would break the ordering rule that a fold writes ClickHouse
before its cache — the cache could hold state that never landed. Upstream
advises against it independently: errors surface only in server logs and there
is no backpressure.

Async insert does not remove the need for client-side batching. Each flush
creates at least one part per distinct partition value, and a flush exceeding
`max_insert_block_size` splits regardless, so a backfill spanning thirty weeks
still produces thirty parts per flush.

## Rationale / Trade-offs

**Why not generate the migrations.** Deployed migrations are immutable history.
The definition is checked against them — extending the existing drift test —
and never generates them.

**Why not keep the catalogue and add rules to the gate.** The gate detects at
runtime what the builder can make unrepresentable at compile time. Detection
still needs someone to write the offending query first. The catalogue survives
as the `defineTable` calls; most of what `convention-gate.ts` polices stops
being expressible.

**Why JSONCompact rather than TabSeparated.** Dropping JSON entirely means
replacing a native C++ parser with an interpreted JS one and owning the escaping
surface (`\t`, `\n`, `\\`, `\N`). That is likely slower and certainly more
dangerous. The win is dropping the *object* encoding, not the JSON codec.

**Why compiled zod rather than hand-written decoders.** Hand-written decoders
are what we have; they drift, and three of them already do. `zod-compiler`
reports 2–43× over interpreted zod and exposes `.is()` for allocation-free
checks. Its documented fallbacks — `.check()`, async transforms, `z.custom()`,
`z.instanceof()`, algorithmic string formats, object intersections — are all
features a column decoder has no reason to use.

**Cost.** Every ClickHouse read and write in the app is rewritten onto this
layer. That is a large mechanical change, and it lands with the event-sourcing
package extraction rather than before it, so repositories move once.

## Consequences

- **The four dedup-scope bugs become unrepresentable**, rather than fixed
  individually and reintroduced by the next copy-paste.
- **`partitionColumnStability` gains its first consumer.** The most dangerous
  fact in the schema stops being a comment.
- **`recordDecode.ts` and every `fromRecord` mapper are deleted.**
- **Row types stop being declared per repository**, so a migration that adds a
  column surfaces at the definition instead of in three partial mappers.
- **A new table cannot ship without stating its merge strategy and partition
  stability**, because there is no builder without them.
- **`aggregating` tables must declare an idempotency story to mount.** The two
  analytics rollups and `gateway_budget_scope_totals` are the current
  population; each needs an answer recorded rather than assumed.
- The wire format changes for every query, so results are validated against the
  server's declared types on first use. Mismatches fail loudly at boot of the
  first read, not silently at the row level.

## In force now

Every table added or re-keyed from this point:

1. Declares itself with `defineTable`, including a `merge` strategy and a role
   mapping for its time columns.
2. Partitions and expires on a frozen, platform-set column. Never on
   `occurredAt`.
3. Elects a version column that can actually order two versions of the same row.
4. Reads through the generated query surface, so dedup, the tenant predicate and
   the partition predicate are defaults rather than conventions.
5. If it is an `aggregating` table, records how a redelivered write avoids
   double counting, or it does not mount.

## Known debt this does not fix yet

These are live defects the decision does not retroactively repair. Each needs a
re-key — create new, backfill, `EXCHANGE TABLES` — because deployed migrations
are immutable, so none of them is a code-only change.

Three of them now carry a `structuralDebt` entry in their table definition, so
the code says what it is doing instead of mislabelling a role to compile. That
does not shorten this list; it makes each item findable by grepping
`structuralDebt` rather than by trusting this document to stay current.

- **`event_log` partitions and expires on customer-supplied `EventOccurredAt`,
  with `DEFAULT 0`.** The highest-consequence item, and the one whose fix is
  cheapest to describe: `CreatedAt` is already in the table.
- **Dedup subqueries bounded on a moving partition column** in the trace-summary
  read path and the evaluation-analytics timeseries. Bounding the inner scope on
  a column that drifts lets the true latest version drop out of its own
  `GROUP BY` group, returning a stale row that is non-null and plausible.
- **`stored_spans` elects `StartTime` as its version column**, which cannot order
  versions because a re-reported span carries the same start time.
- **`evaluation_analytics` never received the storage-anchor split** that
  `trace_analytics` did, so its partition column still moves forward with the
  latest event.
- **`trace_summaries` expires on `OccurredAt`**, a value that moves backwards as
  earlier spans arrive, and epoch sentinel rows exist.
- **`metric_series` and `session_metric_series` each use one moving column as
  version, partition key and TTL anchor at once.**
- **`stored_metric_records` has no TTL** in either the migration or the
  reconciler.
- **`experiment_run_items` elects `OccurredAt` as both its version column and
  its partition key** (`migrations/00002_create_schema.sql:320-321`:
  `ENGINE = ReplacingMergeTree(OccurredAt)` / `PARTITION BY toYearWeek(OccurredAt)`)
  — a single moving column doing both jobs at once, each prohibited by the role
  table above. A correct re-key gives it an `AcceptedAt` column, moves the
  partition expression and the `ReplacingMergeTree` version onto it, and leaves
  `OccurredAt` as a plain display column.
- **`governance_kpis` elects a business-time column as its `ReplacingMergeTree`
  version.** `LastEventOccurredAt` is `TraceSummaryData.occurredAt`
  (`migrations/00065_governance_kpis_event_grain.sql:26`) — customer-supplied, so
  it cannot reliably break a tie between two versions of a row. The read side
  already pays for this: `spendSpikeAnomalyEvaluator.service.ts` has to spell its
  tie-break as `argMax(SpendUsd, (LastEventOccurredAt, SpendUsd))` to get a
  deterministic answer. A re-key moves the version onto a platform-set stamp and
  lets that read revert to the ordinary form.
- **`dspy_steps` partitions on a value taken from a request body.**
  `CreatedAt` anchors `toYearWeek(CreatedAt)` and is set from
  `param.timestamps.created_at` at `routes/misc.ts:1164`. It is frozen — the
  upsert preserves the first write — but a caller chooses it, so a caller
  controls partition spread and part count directly. This is the same failure
  mode as `event_log`'s, reached through an authenticated write path rather than
  through telemetry.
- **`AppliedEventIds` remains load-bearing in a read path.**
  `coding-agent-session.clickhouse.repository.ts:458` puts
  `length(AppliedEventIds) DESC` in a dedup `ORDER BY` as a tie-break. That
  dependency is itself the defect this decision does not fix, not a schedule for
  later — nothing reinstates a refold to repair it, and the array cannot be
  dropped until that tie-break is rewritten onto the version tie-break described
  in ADR-098.

## References

- `src/server/clickhouse/schema-catalogue.ts` — the 33-table catalogue this
  definition subsumes, and the inert accessors it replaces.
- `src/server/clickhouse/recordDecode.ts` — the JSON decode shim this retires.
- `src/server/app-layer/analytics/query-builders/eval-slim-timeseries-query.ts`
  and `slim-timeseries-query.ts` — the byte-identical clone whose safety depends
  on a property neither file states.
- `src/server/app-layer/clients/clickhouse/convention-gate.ts` — the runtime
  gate this layer makes largely redundant.
- ClickHouse JS client format support: `SupportedJSONFormats` /
  `SupportedRawFormats` in `@clickhouse/client`.
- ClickHouse asynchronous inserts, and the part-per-partition-value flush rule.
