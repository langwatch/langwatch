// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null*
// repositories implement the interface as intentional no-ops.

import type { Authorization } from "@langwatch/authorization";
import type { TraceSummaryData } from "@langwatch/trace-contract";

export interface FindByTraceIdOptions {
  /**
   * Approximate trace timestamp (ms since epoch). Narrows the scan to a
   * window so ClickHouse can prune partitions instead of scanning cold storage.
   * Drift up to a few hours is fine.
   */
  occurredAtMs?: number;

  /**
   * Explicit time bound applied verbatim with NO fallback — caller declared
   * the width and owns retry. Takes precedence over occurredAtMs for callers
   * with only a point hint who want the repo to widen it and recover a miss.
   */
  window?: { fromMs: number; toMs: number };
}

/** A single-trace summary read; the proof fences the tenants it may see (ADR-177). */
export type FindByTraceIdParams = {
  authorization: Authorization;
  traceId: string;
} & FindByTraceIdOptions;

/**
 * A summary with the tenant it was read from. A proof may span an aggregate's
 * members and two may hold the same trace id, so the row says whose it is.
 */
export type TraceSummaryRead = TraceSummaryData & { tenantId: string };

export abstract class TraceSummaryRepository {
  abstract upsert(data: TraceSummaryData, tenantId: string, retentionDays: number): Promise<void>;
  abstract upsertBatch?(
    entries: {
      data: TraceSummaryData;
      tenantId: string;
      retentionDays: number;
    }[],
  ): Promise<void>;
  abstract findByTraceId(params: FindByTraceIdParams): Promise<TraceSummaryRead | null>;
  /** The tenants holding a trace, of those the proof reads, ordered by tenant id. */
  abstract findTenantIdsByTraceId(params: {
    authorization: Authorization;
    traceId: string;
  }): Promise<string[]>;
}
