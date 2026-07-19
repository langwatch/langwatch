/**
 * Cold-scan detection for ClickHouse SELECTs.
 *
 * Several of our largest tables are partitioned by a time expression and tier
 * old partitions to S3 (see clickhouse-serverless storage policy). A SELECT
 * that filters one of these tables WITHOUT a predicate on its partition time
 * column cannot prune partitions, so ClickHouse walks every weekly/monthly
 * partition including the cold ones on S3. Each such scan turns into a burst of
 * S3 GET requests, which is the dominant driver of our S3 request bill.
 *
 * This module flags those queries so the resilient client can warn on them.
 * It is detection-only: it never changes the query or its behaviour.
 */

/**
 * Tables partitioned by a time expression, mapped to the column names that, when
 * used in a WHERE/PREWHERE comparison, let ClickHouse prune partitions.
 *
 * Keep in sync with the ClickHouse migrations (PARTITION BY clauses). A table
 * absent from this map is treated as not time-partitioned and never flagged.
 */
export const TIME_PARTITIONED_TABLES = {
  stored_spans: ["StartTime"],
  stored_log_records: ["TimeUnixMs"],
  stored_metric_records: ["TimeUnixMs"],
  event_log: ["EventOccurredAt"],
  billable_events: ["EventTimestamp"],
  governance_ocsf_events: ["EventTime"],
} as const satisfies Record<string, readonly string[]>;

/** Strip line and block comments so they can't hide or fake a predicate. */
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Does the SQL use `column` in a filter comparison (not merely a projection or
 * ORDER BY)? Only a comparison lets ClickHouse derive a partition bound.
 *
 * This is the crux: a query like `SELECT toUnixTimestamp64Milli(StartTime) ...
 * ORDER BY StartTimeMs` references StartTime but still scans every partition
 * (verified on prod: 252/252 parts). A query with `WHERE StartTime >= {from}`
 * prunes (41/255). So we look for the column adjacent to a comparison operator
 * or BETWEEN/IN on either side.
 */
function hasTimePredicate(sql: string, column: string): boolean {
  const col = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // column <op> ...   (e.g. StartTime >= {from})
  const colThenOp = new RegExp(
    `\\b${col}\\b\\s*(?:>=|<=|<>|!=|=|>|<|\\bBETWEEN\\b|\\bIN\\b)`,
    "i",
  );
  // ... <op> column   (e.g. {from} <= StartTime)
  const opThenCol = new RegExp(
    `(?:>=|<=|<>|!=|=|>|<)\\s*\\b${col}\\b`,
    "i",
  );
  return colThenOp.test(sql) || opThenCol.test(sql);
}

/**
 * Returns the name of a time-partitioned table that the query reads without any
 * filter predicate on its partition time column, or null if the query is fine
 * (or not a SELECT against a tracked table).
 *
 * Errs toward flagging: a projection or ORDER BY mention of the time column does
 * NOT clear the flag, because those do not enable partition pruning. A false
 * positive is a cheap advisory log line; a false negative misses real S3 cost.
 */
export function detectColdScan(query: string): string | null {
  if (typeof query !== "string" || query.length === 0) return null;

  const sql = stripComments(query);
  const trimmed = sql.trimStart().toUpperCase();
  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) return null;

  for (const [table, timeColumns] of Object.entries(TIME_PARTITIONED_TABLES)) {
    // Word-boundary match so `stored_spans` doesn't match `stored_spans_v2`.
    const tableRef = new RegExp(`\\b${table}\\b`, "i");
    if (!tableRef.test(sql)) continue;

    const hasPredicate = timeColumns.some((col) => hasTimePredicate(sql, col));
    if (!hasPredicate) return table;
  }

  return null;
}
