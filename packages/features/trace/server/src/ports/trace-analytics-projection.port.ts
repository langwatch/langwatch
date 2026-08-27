import type { TraceAnalyticsRow } from "../projections/trace-derived.projection";

export type TraceAnalyticsProjectionEntry = {
  row: TraceAnalyticsRow;
  retentionDays: number;
  appliedEventIds: string[];
};

export type TraceAnalyticsProjectionRead = {
  row: TraceAnalyticsRow;
  appliedEventIds: string[];
};

/** Private persistence capability for the trace_analytics projection. */
export abstract class TraceAnalyticsProjectionPort {
  abstract upsert(entry: TraceAnalyticsProjectionEntry): Promise<void>;

  async upsertBatch(_entries: TraceAnalyticsProjectionEntry[]): Promise<void> {
    throw new Error("Trace analytics batch persistence is not implemented");
  }

  abstract tryFindByTraceId(input: {
    tenantId: string;
    traceId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<TraceAnalyticsProjectionRead | null>;
}
