/**
 * Cold-scan detection for ClickHouse SELECTs. A SELECT with no predicate on the partition time
 * column cannot prune, so ClickHouse walks the S3-tiered partitions too — the dominant driver of
 * our S3 bill. Detection only; the table list lives in the ClickHouse package, shared with
 * analytics.
 */

import { TIME_PARTITIONED_TABLES } from "@langwatch/clickhouse-client";

/** Strip line and block comments so they can't hide or fake a predicate. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Does the SQL use `column` in a filter comparison rather than merely a projection or ORDER BY?
 * Only a comparison lets ClickHouse derive a partition bound, so this looks for the column
 * adjacent to a comparison operator or to BETWEEN or IN.
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
   * The name of a time-partitioned table the query reads with no filter on its partition time
   * column, or null when fine. Errs toward flagging, since a projection or ORDER BY mention
   * enables no pruning: a false positive is a log line, a false negative is real S3 cost.
   */
  static tryDetectColdScan(query: string): string | null {
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
