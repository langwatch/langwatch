// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

import type { TraceSummaryData } from "@langwatch/trace-contract";

export interface FindByTraceIdOptions {
  /**
   * Approximate trace timestamp (ms since epoch). When given, the repo narrows the scan to a window around it so ClickHouse can prune partitions instead of scanning cold storage. A hint — drift up to a few hours is fine.
   */
  occurredAtMs?: number;

  /**
   * An explicit time bound, applied verbatim with NO internal miss fallback — the caller declared the width (fold's options.readWindow) and owns the retry (executor re-reads without the window on a miss). Takes precedence over occurredAtMs, for callers holding only a point hint who want the repository to widen it AND recover a miss itself.
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
  abstract findByTraceId(
    trace: { tenantId: string; traceId: string },
    options?: FindByTraceIdOptions,
  ): Promise<TraceSummaryData | null>;
}

export class NullTraceSummaryRepository implements TraceSummaryRepository {
  async upsert(_data: TraceSummaryData, _tenantId: string): Promise<void> {}

  async findByTraceId(
    _trace: { tenantId: string; traceId: string },
    _options?: FindByTraceIdOptions,
  ): Promise<TraceSummaryData | null> {
    return null;
  }
}
