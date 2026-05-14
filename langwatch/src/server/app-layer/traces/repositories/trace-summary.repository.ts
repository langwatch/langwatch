import type { TraceSummaryData } from "../types";

export interface FindByTraceIdOptions {
  /**
   * Approximate trace timestamp (ms since epoch). When provided, the repo
   * narrows the scan to a window around it so ClickHouse can prune
   * partitions instead of scanning across all of cold storage. The value
   * is a hint — drift up to a few hours is fine.
   */
  occurredAtMs?: number;
}

export interface TraceSummaryRepository {
  upsert(data: TraceSummaryData, tenantId: string): Promise<void>;
  upsertBatch?(
    entries: Array<{ data: TraceSummaryData; tenantId: string }>,
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
