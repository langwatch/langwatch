import type { IdIndexFillCheckpoint, IdIndexFillReport } from "@langwatch/clickhouse-client";

/** What the trace fill asks of its caller around each filled ClickHouse target. */
export type TraceIdIndexFillInput = Readonly<{
  checkpoint: IdIndexFillCheckpoint;
  signal: AbortSignal;
  dryRun: boolean;
  /** Runs once a target is filled, before its flags: raise the indexes' retention there. */
  beforeFlag: (input: { organizationId?: string | undefined; indexes: string[] }) => Promise<void>;
  /** Sets trace's id-index flag for one flag target (`shared` or a private organisation). */
  setFlag: (input: { target: string }) => Promise<void>;
}>;

/**
 * Trace's id indexes over rows older than their views (goose 00110), filled per ClickHouse
 * target behind a saved cursor (dev/docs/plans/id-index-2026-10-10.md §3).
 */
export abstract class TraceIdIndexFillRepository {
  abstract fill(input: TraceIdIndexFillInput): Promise<IdIndexFillReport>;
}
