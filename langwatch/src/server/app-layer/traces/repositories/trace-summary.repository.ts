// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

import type { TraceSummaryData } from "../types";

export interface FindByTraceIdOptions {
  /**
   * Approximate trace timestamp (ms since epoch). When provided, the repo
   * narrows the scan to a window around it so ClickHouse can prune
   * partitions instead of scanning across all of cold storage. The value
   * is a hint — drift up to a few hours is fine.
   */
  occurredAtMs?: number;

  /**
   * An explicit time bound, applied verbatim with NO internal miss fallback —
   * the caller declared the width (the fold's `options.readWindow`) and owns
   * the retry (the fold executor re-reads without the window on a miss).
   * Takes precedence over `occurredAtMs`, which exists for callers that only
   * hold a point-in-time hint and want the repository to widen it AND recover
   * a miss itself (resolve the trace's real OccurredAt, bound a retry).
   */
  window?: { fromMs: number; toMs: number };
}

export interface TraceSummaryRepository {
  upsert(
    data: TraceSummaryData,
    tenantId: string,
    retentionDays?: number,
  ): Promise<void>;
  upsertBatch?(
    entries: Array<{
      data: TraceSummaryData;
      tenantId: string;
      retentionDays?: number;
    }>,
  ): Promise<void>;
  findByTraceId(
    tenantId: string,
    traceId: string,
    options?: FindByTraceIdOptions,
  ): Promise<TraceSummaryData | null>;
}

export class NullTraceSummaryRepository implements TraceSummaryRepository {
  async upsert(_data: TraceSummaryData, _tenantId: string): Promise<void> {}

  async findByTraceId(
    _tenantId: string,
    _traceId: string,
    _options?: FindByTraceIdOptions,
  ): Promise<TraceSummaryData | null> {
    return null;
  }
}
