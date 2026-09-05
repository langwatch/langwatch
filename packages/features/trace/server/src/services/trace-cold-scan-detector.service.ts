/**
 * Cold-scan detection for ClickHouse SELECTs. Several of our largest tables partition by a time expression and tier old partitions to S3; a SELECT with no predicate on the partition time column can't prune, so ClickHouse walks every partition including cold S3 ones — the dominant driver of our S3 request bill. This module flags those queries so the resilient client can warn on them; detection-only, never changes the query or behaviour. The table list ({@link TIME_PARTITIONED_TABLES}) lives in @langwatch/clickhouse-client, shared with analytics-server's JOIN time-bound guard so the two can't drift.
 */

import { TIME_PARTITIONED_TABLES } from "@langwatch/clickhouse-client";

/** Strip line and block comments so they can't hide or fake a predicate. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Does the SQL use `column` in a filter comparison (not merely a projection or ORDER BY)? Only a comparison lets ClickHouse derive a partition bound — e.g. ORDER BY StartTimeMs still scans every partition (252/252 parts in prod) while WHERE StartTime >= {from} prunes (41/255). So this looks for the column adjacent to a comparison operator or BETWEEN/IN.
 */
function hasTimePredicate(sql: string, column: string): boolean {
  const col = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // column <op> ...   (e.g. StartTime >= {from})
  const colThenOp = new RegExp(`\\b${col}\\b\\s*(?:>=|<=|<>|!=|=|>|<|\\bBETWEEN\\b|\\bIN\\b)`, "i");
  // ... <op> column   (e.g. {from} <= StartTime)
  const opThenCol = new RegExp(`(?:>=|<=|<>|!=|=|>|<)\\s*\\b${col}\\b`, "i");

  return colThenOp.test(sql) || opThenCol.test(sql);
}

export class TraceColdScanDetectorService {
  static create(): TraceColdScanDetectorService {
    return new TraceColdScanDetectorService();
  }

  /**
   * Returns the name of a time-partitioned table the query reads without a filter predicate on its partition time column, or null if fine (or not a tracked SELECT). Errs toward flagging: a projection/ORDER BY mention does NOT clear it, since neither enables pruning — a false positive is a cheap log line, a false negative misses real S3 cost.
   */
  static detectColdScan(query: string): string | null {
    if (typeof query !== "string" || query.length === 0) {
      return null;
    }

    const sql = stripComments(query);
    const trimmed = sql.trimStart().toUpperCase();
    if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
      return null;
    }

    for (const [table, timeColumns] of Object.entries(TIME_PARTITIONED_TABLES)) {
      // Word-boundary match so `stored_spans` doesn't match `stored_spans_v2`.
      const tableRef = new RegExp(`\\b${table}\\b`, "i");
      if (!tableRef.test(sql)) {
        continue;
      }

      const hasPredicate = timeColumns.some((col) => hasTimePredicate(sql, col));
      if (!hasPredicate) {
        return table;
      }
    }

    return null;
  }
}
