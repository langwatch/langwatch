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

This is the most common form of the bug because it looks innocent — surely "give me the row with the largest UpdatedAt" is fine? It is not. ClickHouse must read **every unmerged version** of every row matching the WHERE *together with all heavy columns* (Messages.*, ComputedInput, Inputs, Details, etc.) into memory in order to sort by `UpdatedAt`.

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

| Table | Engine | Version Column | Dedup Key |
|-------|--------|---------------|-----------|
| `simulation_runs` | `ReplacingMergeTree(UpdatedAt)` | `UpdatedAt` | `(TenantId, ScenarioSetId, BatchRunId, ScenarioRunId)` |
| `trace_summaries` | `ReplacingMergeTree(UpdatedAt)` | `UpdatedAt` | `(TenantId, TraceId)` |
| `stored_spans` | `ReplacingMergeTree(StartTime)` | `StartTime` | `(TenantId, TraceId, SpanId)` |
| `evaluation_runs` | `ReplacingMergeTree(UpdatedAt)` | `UpdatedAt` | `(TenantId, EvaluationId)` |
| `experiment_runs` | `ReplacingMergeTree(UpdatedAt)` | `UpdatedAt` | `(TenantId, RunId, ExperimentId)` |

**Note:** `stored_spans` uses `StartTime` as the version column, NOT `UpdatedAt`. Use `max(StartTime)` for dedup on that table.

## UpdatedAt is Monotonically Increasing

The event sourcing framework guarantees unique, monotonically increasing `UpdatedAt` values:

```typescript
// abstractFoldProjection.ts
const nextUpdatedAt = Math.max(Date.now(), prevUpdatedAt + 1);
```

This means:
- **No ties possible** — every fold bumps `UpdatedAt` to at least `prevUpdatedAt + 1`
- **`max(UpdatedAt)` always identifies exactly one row** per dedup key
- The IN-tuple pattern is safe without additional tie-breaking

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

| Table | Partition Key |
|-------|--------------|
| `simulation_runs` | `toYearWeek(StartedAt)` |
| `trace_summaries` | `toYearWeek(OccurredAt)` |
| `stored_spans` | `toYearWeek(StartTime)` |
| `evaluation_runs` | `toYearWeek(UpdatedAt)` |

## TenantId is Always Required

Every ClickHouse query MUST include `WHERE TenantId = {tenantId:String}`. No other ID (ScenarioRunId, BatchRunId, TraceId, etc.) is unique across tenants.

## Code Review Checklist

When reviewing a PR that touches a `*.clickhouse.repository.ts` or any service hitting ClickHouse, scan for:

- **`ORDER BY <version_col> DESC LIMIT 1`** against any `ReplacingMergeTree` table — replace with the IN-tuple dedup pattern above. Do not let "but it's a single-row lookup" rationalise it through.
- **`LIMIT 1 BY <key>`** with any heavy column in the SELECT — replace with the IN-tuple form.
- **`max(<column>)` used as a pagination cursor** instead of `argMax(<column>, UpdatedAt)` — pagination cursors derived from non-version columns can read stale values.
- **Missing partition predicate** when a date range is available — every weekly-partitioned table (`trace_summaries`, `simulation_runs`, `stored_spans`, `evaluation_runs`, ...) needs a WHERE on its partition column to enable pruning.
- **Heavy columns in dedup subqueries** — anything like `Messages.Content`, `Inputs`, `Details`, `ComputedInput`, `SpanAttributes`, `Examples`, `LlmCalls` belongs only in the outer SELECT, never in the dedup subquery.

These checks belong in code review because they're query-shape problems, not type problems — typecheck and unit tests will not catch them. CI integration tests will pass while production grinds to a halt under merge backlog.
