import type { Authorization } from "@langwatch/authorization";

import type { TraceAnalyticsRow } from "../eventing/trace-derived.projection.ts";

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
export abstract class TraceAnalyticsProjectionRepository {
  abstract upsert(entry: TraceAnalyticsProjectionEntry): Promise<void>;

  async upsertBatch(_entries: TraceAnalyticsProjectionEntry[]): Promise<void> {
    throw new Error("Trace analytics batch persistence is not implemented");
  }

  /** The proof fences the tenants the read sees; the fold passes an own-only one. */
  abstract findByTraceId(input: {
    authorization: Authorization;
    traceId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<TraceAnalyticsProjectionRead | null>;
}
