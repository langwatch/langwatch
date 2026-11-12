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
  /** A read-back column would not decode: the fold rebuilds instead of storing over it. */
  undecodable?: true;
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

  /**
   * Each found trace's OccurredAt (the storage anchor) inside the window, or anywhere with none;
   * a trace not found adds nothing. One read per trace here; a store that can read them together
   * overrides it.
   */
  async findOccurredAtByTraceIds(input: {
    authorization: Authorization;
    traceIds: readonly string[];
    window?: { fromMs: number; toMs: number };
  }): Promise<{ traceId: string; occurredAtMs: number }[]> {
    const found: { traceId: string; occurredAtMs: number }[] = [];
    for (const traceId of new Set(input.traceIds)) {
      const read = await this.findByTraceId({ ...input, traceId });
      if (read) found.push({ traceId, occurredAtMs: read.row.occurredAtMs });
    }
    return found;
  }
}
