/**
 * Cold-scan detection for ClickHouse SELECTs.
 *
 * Several of our largest tables are partitioned by a time expression and tier
 * old partitions to S3 (see clickhouse-serverless storage policy). A SELECT
 * that filters one of these tables WITHOUT any predicate on its time column
 * cannot prune partitions, so ClickHouse walks every weekly/monthly partition
 * including the cold ones on S3. Each such scan turns into a burst of S3 GET
 * requests, which is the dominant driver of our S3 request bill.
 *
 * This module flags those queries so the resilient client can warn on them.
 * It is detection-only: it never changes the query or its behaviour.
 */

/**
 * Tables partitioned by a time expression, mapped to the column names that, if
 * referenced in the WHERE/PREWHERE, let ClickHouse prune partitions.
 *
 * Keep in sync with the ClickHouse migrations (PARTITION BY clauses). A table
 * absent from this map is treated as not time-partitioned and never flagged.
 */
export const TIME_PARTITIONED_TABLES: Record<string, readonly string[]> = {
  stored_spans: ["StartTime"],
  stored_log_records: ["TimeUnixMs"],
  stored_metric_records: ["TimeUnixMs"],
  event_log: ["EventOccurredAt"],
  billable_events: ["EventTimestamp"],
  governance_ocsf_events: ["EventTime"],
};

/** Strip line and block comments so they can't hide or fake a time predicate. */
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Returns the name of a time-partitioned table that the query reads without any
 * reference to its time column, or null if the query is fine (or not a SELECT
 * against a tracked table).
 *
 * Heuristic and deliberately conservative: it only flags when we both see the
 * table name AND see none of that table's time columns anywhere in the SQL.
 * Referencing the time column for any reason (filter, projection, ORDER BY)
 * clears the flag — partition pruning only needs it in the filter, so this
 * errs toward NOT warning rather than crying wolf.
 */
export function detectColdScan(query: string): string | null {
  if (typeof query !== "string" || query.length === 0) return null;

  const sql = stripComments(query);
  const upper = sql.toUpperCase();

  const trimmed = upper.trimStart();
  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) return null;

  for (const [table, timeColumns] of Object.entries(TIME_PARTITIONED_TABLES)) {
    // Word-boundary match so `stored_spans` doesn't match `stored_spans_v2`.
    const tableRef = new RegExp(`\\b${table}\\b`, "i");
    if (!tableRef.test(sql)) continue;

    const hasTimeColumn = timeColumns.some((col) =>
      new RegExp(`\\b${col}\\b`, "i").test(sql),
    );
    if (!hasTimeColumn) return table;
  }

  return null;
}
