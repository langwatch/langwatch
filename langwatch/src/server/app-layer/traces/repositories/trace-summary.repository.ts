import type { TraceSummaryData } from "../types";

/**
 * A pinned trace as projected onto `trace_summaries` — the shape the pinning
 * service reads (replacing the legacy `PinnedTrace` Postgres row).
 */
export interface PinnedTraceSummary {
  traceId: string;
  source: "manual" | "share";
  reason: string | null;
  pinnedByUserId: string | null;
  pinnedAt: number | null;
}

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
  upsert(data: TraceSummaryData, tenantId: string, retentionDays?: number): Promise<void>;
  upsertBatch?(
    entries: Array<{ data: TraceSummaryData; tenantId: string; retentionDays?: number }>,
  ): Promise<void>;
  findByTraceId(
    tenantId: string,
    traceId: string,
    options?: FindByTraceIdOptions,
  ): Promise<TraceSummaryData | null>;
  /**
   * Lists the currently-pinned traces for a tenant (latest version per trace,
   * PinnedSource != ''). Backs the pinning service's project-wide reads.
   */
  findPinnedTraces(tenantId: string): Promise<PinnedTraceSummary[]>;
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

  async findPinnedTraces(_tenantId: string): Promise<PinnedTraceSummary[]> {
    return [];
  }
}
