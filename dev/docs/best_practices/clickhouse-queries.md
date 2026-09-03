# ClickHouse Query Best Practices

## Deduplication — Never Use Heavy Columns in Dedup Subqueries

ClickHouse tables use `ReplacingMergeTree` for deduplication. Until background merges complete, multiple versions of a row coexist. Queries must deduplicate at read time.

### Anti-Pattern 1: `ORDER BY <version> DESC LIMIT 1` (DO NOT USE)

```sql
-- WRONG: load the latest version of one row by sorting all matching versions.
SELECT <heavy_columns>
FROM table
WHERE TenantId = {tenantId:String}
  AND <key> = {key:String}
ORDER BY UpdatedAt DESC
LIMIT 1
```

This is the most common form of the bug because it looks innocent — surely "give me the row with the largest UpdatedAt" is fine? It is not. ClickHouse must read **every unmerged version** of every row matching the WHERE _together with all heavy columns_ (Messages.*, ComputedInput, Inputs, Details, etc.) into memory in order to sort by `UpdatedAt`.

Under load, a single `(TenantId, key)` can have hundreds of unmerged versions of multi-MB rows. Production has observed individual `getByKey` calls reading 5+ MB and entire fleets driving 1+ GB/s of read traffic from these calls, saturating ClickHouse and stalling concurrent inserts. **Always use the IN-tuple form below for "latest version of one row" lookups.**

### Anti-Pattern 2: `LIMIT 1 BY` over heavy columns (DO NOT USE)

```sql
-- WRONG: reads Messages, RoleCosts, Metadata etc. for entire granule (~8K rows)
-- just to pick the latest version. Causes CANNOT_ALLOCATE_MEMORY on large parts.
SELECT <heavy_columns>
FROM (
  SELECT <heavy_columns>
  FROM table
  WHERE TenantId = {tenantId:String} AND ...
  ORDER BY key, UpdatedAt DESC
  LIMIT 1 BY TenantId, key
)
WHERE ArchivedAt IS NULL
```

ClickHouse reads data in granules (~8192 rows). `LIMIT 1 BY` requires all selected columns to be materialized for every row in the granule before dedup. If those columns include `Messages.Content`, `ComputedInput`, `SpanAttributes`, etc., a single granule can exceed the memory limit.

### Safe Pattern: IN-Tuple Dedup

```sql
-- CORRECT: inner subquery reads only lightweight key columns for dedup,
-- outer query reads heavy columns only for matched rows.
SELECT <heavy_columns>
FROM table AS t
WHERE t.TenantId = {tenantId:String}
  AND t.<filters>
  AND t.ArchivedAt IS NULL
  AND (t.TenantId, t.Key, t.UpdatedAt) IN (
    SELECT TenantId, Key, max(UpdatedAt)
    FROM table
    WHERE TenantId = {tenantId:String}
      AND <same_filters>
    GROUP BY TenantId, Key
  )
ORDER BY ...
LIMIT ...
```

**Why this works:** The inner `GROUP BY` reads only key columns + `UpdatedAt` (no heavy data). The outer `SELECT` then reads heavy columns only for the rows that matched the `IN` predicate — typically a tiny fraction of the granule.

### Single-Row Lookups: Scalar Subquery

```sql
-- For fetching a single row by ID:
SELECT <heavy_columns>
FROM table AS t
WHERE t.TenantId = {tenantId:String}
  AND t.Id = {id:String}
  AND t.ArchivedAt IS NULL
  AND t.UpdatedAt = (
    SELECT max(s.UpdatedAt)
    FROM table AS s
    WHERE s.TenantId = t.TenantId AND s.Id = t.Id
  )
LIMIT 1
```

**Important:** Use table aliases (`t.`, `s.`) in the WHERE clause. Some column projections (e.g. `toString(UpdatedAt) AS UpdatedAt` in `RUN_COLUMNS`) create aliases that shadow the raw column. Without table aliases, ClickHouse may resolve `UpdatedAt` to the `String` alias instead of the `DateTime64` column, causing type mismatch errors.

## Version Columns per Table

| Table             | Engine                          | Version Column | Dedup Key                         |
| ----------------- | ------------------------------- | -------------- | --------------------------------- |
| `simulation_runs` | `ReplacingMergeTree(UpdatedAt)` | `UpdatedAt`    | `(TenantId, ScenarioRunId)`       |
| `trace_summaries` | `ReplacingMergeTree(UpdatedAt)` | `UpdatedAt`    | `(TenantId, TraceId)`             |
| `stored_spans`    | `ReplacingMergeTree(StartTime)` | `StartTime`    | `(TenantId, TraceId, SpanId)`     |
| `evaluation_runs` | `ReplacingMergeTree(UpdatedAt)` | `UpdatedAt`    | `(TenantId, EvaluationId)`        |
| `experiment_runs` | `ReplacingMergeTree(UpdatedAt)` | `UpdatedAt`    | `(TenantId, RunId, ExperimentId)` |

**Note:** `stored_spans` uses `StartTime` as the version column, NOT `UpdatedAt`. Use `max(StartTime)` for dedup on that table.

## UpdatedAt is Monotonically Increasing

The event sourcing framework guarantees unique, monotonically increasing `UpdatedAt` values:

```typescript
// abstractFoldProjection.ts
const nextUpdatedAt = Math.max(Date.now(), prevUpdatedAt + 1);
```

This means:

- **Within one state chain, no ties** — each fold bumps `UpdatedAt` to at least `prevUpdatedAt + 1`, so successive versions written by one writer strictly increase

**It does NOT mean `max(UpdatedAt)` identifies exactly one row.** The bump is
relative to the `prevUpdatedAt` the writer _loaded_, so two writers that both
resume from the same committed version compute their next stamp from the same
predecessor and can land on the same millisecond. Both then satisfy the
IN-tuple, and a bare `LIMIT 1` picks between them arbitrarily — returning a
stale version that the fold resumes from and rewrites, silently dropping the
other version's contributions.

So the IN-tuple narrows the candidates but does not order them. Give the outer
scope a deterministic `ORDER BY … LIMIT 1` whenever a tie is reachable, ranked
by whatever monotonically records how far each version's fold actually got
(a progress watermark, a count that only increments), never by a value that can
move in both directions. See `trace-analytics.clickhouse.repository.ts` and
`evaluation-analytics.clickhouse.repository.ts` for worked examples, and note
that the sort is cheap there precisely because the IN-tuple has already reduced
the outer scope to one or two rows — it is not the "sort the whole table"
anti-pattern below.

## Pagination with Dedup

When paginating deduped data, derive sort keys from the **latest version** of each row:

```sql
-- WRONG: max(OccurredAt) may come from an old version
SELECT TraceId, max(OccurredAt) AS _oa FROM trace_summaries GROUP BY TraceId

-- CORRECT: OccurredAt from the row with the latest UpdatedAt
SELECT TraceId, argMax(OccurredAt, UpdatedAt) AS _oa FROM trace_summaries GROUP BY TraceId
```

Using `max(column)` for sort keys can select values from stale versions, causing cursor pagination to skip or duplicate rows at page boundaries.

## Always Filter on the Partition Key

Tables use weekly partitions (e.g. `toYearWeek(StartedAt)`, `toYearWeek(OccurredAt)`). Without a WHERE filter on the partition column, ClickHouse scans ALL partitions — including cold storage on S3. This turns a 100ms query into a 1-2s query.

When a date range is available, always add a WHERE filter on the partition column:

```sql
-- WRONG: HAVING on max(CreatedAt) doesn't help partition pruning
WHERE TenantId = {tenantId:String}
GROUP BY BatchRunId
HAVING toUnixTimestamp64Milli(max(CreatedAt)) >= ...

-- CORRECT: WHERE on StartedAt enables partition pruning (~12x faster)
WHERE TenantId = {tenantId:String}
  AND StartedAt >= fromUnixTimestamp64Milli(...)
  AND StartedAt <= fromUnixTimestamp64Milli(...)
GROUP BY BatchRunId
HAVING toUnixTimestamp64Milli(max(CreatedAt)) >= ...
```

Keep both: the WHERE prunes partitions, the HAVING ensures exact filtering for the edge case where `StartedAt` and `CreatedAt` differ.

| Table             | Partition Key             |
| ----------------- | ------------------------- |
| `simulation_runs` | `toYearWeek(StartedAt)`   |
| `trace_summaries` | `toYearWeek(OccurredAt)`  |
| `stored_spans`    | `toYearWeek(StartTime)`   |
| `evaluation_runs` | `toYearWeek(ScheduledAt)` |

## TenantId is Always Required

Every ClickHouse query MUST include `WHERE TenantId = {tenantId:String}`. No other ID (ScenarioRunId, BatchRunId, TraceId, etc.) is unique across tenants.

### Carve-out: boot-time system sweeps

A query may omit the `TenantId` filter **only** when every one of these holds:

1. It runs from a system/background entrypoint (worker boot, cron, metering sweep) where there is genuinely **no tenant in context** — not a request path, not a tRPC/Hono handler.
2. It runs on the **shared** ClickHouse client, and the code says so. Tenants on private instances (`CLICKHOUSE_URL__*`) are therefore out of its reach — state that limitation where the sweep is defined.
3. It **SELECTs** `TenantId` rather than filtering on it, and every downstream write is re-scoped per row to that row's own `TenantId`. A sweep that reads cross-tenant and writes with a single tenant id is a data-corruption bug.
4. The omission carries an inline comment explaining which of these applies, so a future "you forgot the tenant filter" fix does not silently narrow the sweep to one tenant.
5. A test pins the cross-tenant behaviour — otherwise item 4's regression passes CI. Single-tenant fixtures cannot catch it.

No sweeps currently use this carve-out — the two boot-time orphan
reconcilers that did (`scenario-orphan-reconciler.ts`,
`orphaned-run-reconciliation.clickhouse.ts`) were deleted under ADR-094. The
rules above stay as the bar any future sweep must clear.

Anything else that wants to skip the filter should be a repository method taking a `tenantId`, not a sweep.

### Carve-out: organization-scoped billing ledgers

A table whose whole purpose is to total usage _across_ an organization's projects cannot lead with `TenantId` — the aggregate it exists to answer has no single tenant. One table qualifies today:

- `metric_usage_estimates` (`queryMetricUsageEstimates`, `metric-data-point.usage.ts`) — ORDER BY `(OrganizationId, TenantId, PointId)`.

It is allowed to lead with `OrganizationId` **only** because all of these hold:

1. The `OrganizationId = {organizationId:String}` predicate **is** the isolation boundary here, exactly as `TenantId` is elsewhere. Do not mistake client selection for that boundary: `getClickHouseClientForOrganization` returns a private instance only when a `CLICKHOUSE_URL__<org>` entry exists and otherwise falls back to the **shared** client, which is the common case — so on a shared instance every organization's rows live in one `metric_usage_estimates` table and the predicate is the only thing separating them. Never relax it, and never widen it to a table holding customer data on the theory that instances are per-organization. The repository still takes the organization resolver as a **required** constructor argument, so which client is used stays an explicit decision rather than a default inherited from the project resolver.
2. `OrganizationId` leads the table's sort key, so the predicate order matches the index. A `TenantId`-first predicate would be both wrong for the aggregate and worse for the scan.
3. `TenantId` is still ANDed in whenever the caller supplies one, and remains a selected grouping dimension.
4. The table holds identifiers and byte counts only — never attributes, values, buckets or payloads — so a scoping mistake cannot leak customer data.
5. A test pins that the organization-wide path uses the organization-resolved client and filters on `OrganizationId`.
6. The caller has already proven the requesting user belongs to `organizationId`. The repository asserts only that the string is non-empty — it authenticates nothing. `queryMetricUsageEstimates` has no callers yet, so this costs nothing today; whoever wires the first route owns the membership check, because with condition 1 the predicate is the boundary and an unchecked `organizationId` from a request hands the caller someone else's ledger.

A new table wanting this carve-out needs all six, plus a line here. Anything that merely _finds it convenient_ to skip `TenantId` does not qualify.

## Validate Rows at the Boundary with Zod

Parse every `result.json()` through a Zod schema before the rows leave the
repository, and derive the returned type with `z.infer<>` — one source of truth
for shape and validation. ClickHouse is a trust boundary: JSONEachRow renders
aggregated numerics (`sum`, `count`, `uniqExact`) as strings once they exceed
JS-safe range, LEFT-JOIN gaps surface as nulls where the interface said
`string`, and a migration can rename a column under you. `.parse()` at the read
boundary catches all three; `.catch()` on individual fields provides safe
defaults for expected variations, while fields without one fail fast on drift.

Reference implementation:
`packages/features/trace/server/src/repositories/clickhouse/trace-event-payload.repository.ts`
(the pattern arrived with PR #7146's governance activity-monitor repositories,
which did not survive the platform split in that shape). New
`*.clickhouse.repository.ts` files should follow it; existing ones migrate
opportunistically when their queries change anyway.

## JOINs — Prefer Not To, Then Prefer `IN`

ClickHouse is not Postgres here. The planner streams the **right-hand** side into
an in-memory hash structure and probes it with the left, and it does far less
join reordering than a row store would. So the shape you write is close to the
shape that runs, and a JOIN that looks harmless in SQL can be the thing that
holds a query's whole memory budget.

The rules, in the order you should reach for them:

**1. Do the join at WRITE time if the domain allows it.** The gateway-spend
pipeline is the worked example: admission and outcome are two events that need
joining, and the fold collapses them into one `gateway_spend` row as they land.
The read side then has no JOIN at all, and "which requests are still open" is a
`WHERE Status = 'admitted'` rather than a self-join. That is why those read paths
contain zero SQL JOINs — not restraint, design.

**2. Use `IN` for existence checks.** If you only need to know that a key exists
in another result, `IN` beats a JOIN: it builds a hash SET rather than a hash
TABLE and never materialises the other side's columns. This is already the
mandated dedup shape above — `WHERE (TenantId, Id, EventTimestamp) IN (SELECT
... max(EventTimestamp) ... GROUP BY ...)` is a semi-join written as `IN` on
purpose.

**3. Put the smaller side on the RIGHT.** The right side is the one that gets
hashed into memory. Getting this backwards on a fact-vs-dimension join is the
difference between hashing a few thousand rows and hashing the fact table.

**4. Filter BOTH sides before joining, never join raw tables.** Wrap each side
in a CTE or subquery that applies its tenant predicate, its partition predicate
and its dedup first. `gateway_budget_scope_totals` reconciliation
(`00069`/`00070`) is the shape to copy: both sides are pre-aggregated to the same
grain by the time they meet, so the JOIN sees two small results rather than two
tables.

**5. Match join-key types EXACTLY.** A cast in the join key runs per row and can
break matching outright. `FixedString(N)` is null-padded, so it does **not**
compare to `String` the way you would expect — and note that `IN` is more
forgiving about this than a JOIN key is, so a filter that works is not evidence
that a join will.

If the types genuinely differ, cast the **parameter** side, not the column:

```sql
-- WRONG: casts the table column, per row, and takes it out of its native type
INNER JOIN spans ON CAST(points.SeriesId AS String) = spans.SpanSeriesId

-- RIGHT: normalise the bound parameter once, leave the column alone
INNER JOIN spans ON points.SeriesId = CAST(spans.SpanSeriesId AS FixedString(64))
```

See issue #7097 for a live instance of the wrong form.

**6. Dictionaries for star-schema lookups.** For a small dimension joined to a
large fact table, a ClickHouse Dictionary turns the JOIN into a direct hash
lookup (`dictGet`). Nothing in this repo uses one today — if you find yourself
repeatedly joining a small, slow-changing lookup table onto a big one, a
dictionary is the intended tool, and worth an ADR rather than a quiet
introduction.

## Code Review Checklist

When reviewing a PR that touches a `*.clickhouse.repository.ts` or any service hitting ClickHouse, scan for:

- **`ORDER BY <version_col> DESC LIMIT 1`** against any `ReplacingMergeTree` table — replace with the IN-tuple dedup pattern above. Do not let "but it's a single-row lookup" rationalise it through.
- **`LIMIT 1 BY <key>`** with any heavy column in the SELECT — replace with the IN-tuple form.
- **`max(<column>)` used as a pagination cursor** instead of `argMax(<column>, UpdatedAt)` — pagination cursors derived from non-version columns can read stale values.
- **Missing partition predicate** when a date range is available — every weekly-partitioned table (`trace_summaries`, `simulation_runs`, `stored_spans`, `evaluation_runs`, ...) needs a WHERE on its partition column to enable pruning.
- **Heavy columns in dedup subqueries** — anything like `Messages.Content`, `Inputs`, `Details`, `ComputedInput`, `SpanAttributes`, `Examples`, `LlmCalls` belongs only in the outer SELECT, never in the dedup subquery.
- **A range filter on a MOVABLE column inside a dedup subquery** — the previous check says to add a partition predicate; this one says where it may not go. If the partition column can change after the row is written (a fold taking `min`/`max` over business time — `coding_agent_sessions.StartedAt`, `trace_analytics.OccurredAt`, `evaluation_analytics.OccurredAt` all do), then range-filtering the inner `max(<version>)` scope drops the true latest version out of its own dedup group the moment it drifts past the window edge. The group resolves to a **stale in-window version** and the outer scope returns it — non-null, plausible, and no fallback catches it. **Bound the outer scope for pruning; leave the dedup scope unbounded on that column.** Not even an upper bound is safe: a read-back miss re-runs `init()` and can re-stamp the anchor _forwards_, so "the latest version holds the smallest value" does not hold. Only the **key** narrowing (`TenantId`) belongs in both scopes. Nothing else qualifies just by looking stable: `UserId` is written by the fold, is absent from spans, and returns to `null` whenever a read-back miss re-runs `init()`, so a later version can carry an empty value, hold `max(<version>)`, and hide the true latest from a `UserId`-filtered group — the same defect in a column that never moves in a range sense. Narrow on it in the outer scope only, and accept that a session whose newest version lost the value leaves the filtered list. See ADR-071 and `coding-agent-session.clickhouse.repository.ts` (`findManyRecent` / `findLatestRecord`), which document both the rule and its scan cost.

- **A `CAST` inside a JOIN key** — cast the bound parameter instead, so the column keeps its declared type. `FixedString(N)` vs `String` is the usual culprit, and it can silently drop rows rather than just cost time.
- **A JOIN against a raw table** — pre-filter each side in a CTE/subquery first (tenant, partition, dedup), so the hash side is a small result rather than a table.
- **The larger side on the right** — the right side is hashed into memory; put the smaller result there.
- **A JOIN used only to test existence** — rewrite as `IN`, which builds a hash set and never materialises the other side's columns.

These checks belong in code review because they're query-shape problems, not type problems — typecheck and unit tests will not catch them. CI integration tests will pass while production grinds to a halt under merge backlog.
