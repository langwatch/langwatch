import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  TraceSummaryRepository,
  type FindByTraceIdOptions,
} from "../../trace-summary.repository.ts";

function summaryKey(tenantId: string, traceId: string): string {
  return `${tenantId} ${traceId}`;
}

/**
 * The read side of trace_summaries in memory: the last summary written per
 * tenant and trace, answered back verbatim. The read window and the partition
 * hint are accepted and ignored - neither prunes anything without partitions.
 */
export class MemoryTraceSummaryRepository extends TraceSummaryRepository {
  readonly #summaries = new Map<string, TraceSummaryData>();

  static create(): MemoryTraceSummaryRepository {
    return new MemoryTraceSummaryRepository();
  }

  async upsert(data: TraceSummaryData, tenantId: string, _retentionDays?: number): Promise<void> {
    this.#summaries.set(summaryKey(tenantId, data.traceId), data);
  }

  async upsertBatch(
    entries: Array<{ data: TraceSummaryData; tenantId: string; retentionDays?: number }>,
  ): Promise<void> {
    for (const entry of entries) await this.upsert(entry.data, entry.tenantId);
  }

  async tryFindByTraceId(
    trace: { tenantId: string; traceId: string },
    _options?: FindByTraceIdOptions,
  ): Promise<TraceSummaryData | null> {
    return this.#summaries.get(summaryKey(trace.tenantId, trace.traceId)) ?? null;
  }
}
