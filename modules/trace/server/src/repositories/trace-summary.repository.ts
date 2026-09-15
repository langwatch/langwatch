// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null*
// repositories implement the interface as intentional no-ops.

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

export abstract class TraceSummaryRepository {
  abstract upsert(data: TraceSummaryData, tenantId: string, retentionDays?: number): Promise<void>;
  abstract upsertBatch?(
    entries: Array<{
      data: TraceSummaryData;
      tenantId: string;
      retentionDays?: number;
    }>,
  ): Promise<void>;
  abstract tryFindByTraceId(
    trace: { tenantId: string; traceId: string },
    options?: FindByTraceIdOptions,
  ): Promise<TraceSummaryData | null>;
}

export class NullTraceSummaryRepository implements TraceSummaryRepository {
  async upsert(_data: TraceSummaryData, _tenantId: string): Promise<void> {}

  async tryFindByTraceId(
    _trace: { tenantId: string; traceId: string },
    _options?: FindByTraceIdOptions,
  ): Promise<TraceSummaryData | null> {
    return null;
  }
}
