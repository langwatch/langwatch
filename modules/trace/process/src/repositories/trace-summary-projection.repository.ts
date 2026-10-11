import type { Authorization } from "@langwatch/authorization";
import type { IdIndexFlags } from "@langwatch/clickhouse-client";
import type { TraceSummaryData } from "@langwatch/trace-contract";

export type TraceSummaryReadWindow = {
  fromMs: number;
  toMs: number;
};

export type TraceSummaryProjectionEntry = {
  data: TraceSummaryData;
  tenantId: string;
  retentionDays: number;
};

/** Private persistence capability for the trace_summaries projection. */
export abstract class TraceSummaryProjectionRepository {
  abstract upsert(entry: TraceSummaryProjectionEntry): Promise<void>;

  async upsertBatch(_entries: TraceSummaryProjectionEntry[]): Promise<void> {
    throw new Error("Trace summary batch persistence is not implemented");
  }

  /** The proof fences the tenants the read sees; the fold passes an own-only one. */
  abstract findByTraceId(input: {
    authorization: Authorization;
    traceId: string;
    window?: TraceSummaryReadWindow;
    /** Trace's id-index flags: with no window and the flag on, the index bounds the read. */
    idIndex?: IdIndexFlags | undefined;
  }): Promise<TraceSummaryData | null>;
}
