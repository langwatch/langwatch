/**
 * The explicit statement for a read with no estimable time range.
 *
 * The convention gate refuses a read that cannot prune partitions. Most
 * reads carry a real range and bound on it. A read that genuinely cannot
 * estimate one — a point lookup by id, a reconciliation sweep — states that
 * here, and gets a real predicate in return: the partition column bounded at
 * the widest range a live row can occupy. That is the table's retention
 * window plus a lazy-TTL cushion, because TTL deletes by merge, and a row
 * can outlive its retention until the delete lands.
 *
 * Pass the tenant's own retention when the caller knows it. The default is
 * the `_retention_days` column default (308d), the widest value a row gets
 * without an explicit override. A tenant CAN override higher — pass that
 * value through, or the read misses their oldest live rows.
 */
import { MIGRATION_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";

export const TTL_LAG_CUSHION_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionBound {
  /** Splice after the query's other predicates: `` `... ${bound.fragment}` `` */
  readonly fragment: string;
  /** Merge into the query's params: `{ ...params, ...bound.params }` */
  readonly params: Readonly<Record<string, string | Date>>;
}

export function retentionBound({
  column,
  chType = "DateTime64(3)",
  retentionDays = MIGRATION_DEFAULT_RETENTION_DAYS,
  now = Date.now(),
}: {
  /** The table's partition column (see SCHEMA_CATALOGUE). */
  column: string;
  /** The column's ClickHouse type. Epoch-ms columns pass "UInt64". */
  chType?: "DateTime64(3)" | "UInt64" | "Int64";
  /** The tenant's retention when known; the column default otherwise. */
  retentionDays?: number;
  now?: number;
}): RetentionBound {
  const fromMs = now - (retentionDays + TTL_LAG_CUSHION_DAYS) * DAY_MS;
  const value =
    chType === "UInt64" || chType === "Int64"
      ? String(fromMs)
      : new Date(fromMs);
  return {
    fragment: `AND ${column} >= {retentionBoundFrom:${chType}}`,
    params: { retentionBoundFrom: value },
  };
}
