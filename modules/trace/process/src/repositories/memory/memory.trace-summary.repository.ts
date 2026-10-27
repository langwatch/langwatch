import { type Authorization, projectIdsReadBy } from "@langwatch/authorization";
import type { TraceSummaryData } from "@langwatch/trace-contract";

import {
  TraceSummaryRepository,
  type FindByTraceIdParams,
  type TraceSummaryRead,
} from "../trace-summary.repository.ts";

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
    entries: { data: TraceSummaryData; tenantId: string; retentionDays?: number }[],
  ): Promise<void> {
    for (const entry of entries) await this.upsert(entry.data, entry.tenantId);
  }

  async findByTraceId({
    authorization,
    traceId,
  }: FindByTraceIdParams): Promise<TraceSummaryRead | null> {
    const [tenantId] = await this.findTenantIdsByTraceId({ authorization, traceId });
    const summary =
      tenantId === undefined ? undefined : this.#summaries.get(summaryKey(tenantId, traceId));
    return tenantId === undefined || summary === undefined ? null : { ...summary, tenantId };
  }

  async findTenantIdsByTraceId({
    authorization,
    traceId,
  }: {
    authorization: Authorization;
    traceId: string;
  }): Promise<string[]> {
    return projectIdsReadBy(authorization).filter((tenantId) =>
      this.#summaries.has(summaryKey(tenantId, traceId)),
    );
  }
}
