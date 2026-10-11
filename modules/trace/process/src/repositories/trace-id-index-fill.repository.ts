import type {
  IdIndexFillReport,
  IdIndexFlags,
  IdIndexOwnerFill,
} from "@langwatch/clickhouse-client";

/**
 * Trace's id indexes over rows older than their views (goose 00110), filled per ClickHouse
 * target behind a saved cursor, and whether a target's are ready, read from their marker rows
 * (dev/docs/plans/id-index-2026-10-10.md §2, §3).
 */
export abstract class TraceIdIndexFillRepository {
  abstract fill(input: IdIndexOwnerFill): Promise<IdIndexFillReport>;
  /** Whether trace's id indexes are ready on a target, answered from memory. */
  abstract readonly readiness: IdIndexFlags;
}
