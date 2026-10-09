import { fenceFor, type TenantFence } from "@langwatch/authorization/tenant-fence";
import type { TraceSummaryData } from "@langwatch/trace-contract";

import {
  TraceSummaryRepository,
  type FindByTraceIdParams,
  type TraceSummaryRead,
} from "../trace-summary.repository.ts";

function summaryKey(tenantId: string, traceId: string): string {
  return `${tenantId} ${traceId}`;
}

/** Whether the fence reads a row of this tenant stored at `atMs`, as the ClickHouse fence does. */
function fenceAdmits({
  fence,
  tenantId,
  atMs,
}: {
  fence: TenantFence;
  tenantId: string;
  atMs: number;
}): boolean {
  if (fence.own.includes(tenantId)) return true;
  return fence.shared.some(
    (window) =>
      window.projectId === tenantId &&
      atMs >= window.from &&
      (window.until === null || atMs < window.until),
  );
}

/**
 * The read side of trace_summaries in memory: the last summary written per tenant and trace,
 * read back through the proof's fence (ADR-175), windowed on the storage anchor like the
 * `OccurredAt` column. The read window and partition hint prune nothing here and are ignored.
 */
export class MemoryTraceSummaryRepository extends TraceSummaryRepository {
  readonly #summaries = new Map<string, { tenantId: string; data: TraceSummaryData }>();

  static create(): MemoryTraceSummaryRepository {
    return new MemoryTraceSummaryRepository();
  }

  async upsert(data: TraceSummaryData, tenantId: string, _retentionDays?: number): Promise<void> {
    this.#summaries.set(summaryKey(tenantId, data.traceId), { tenantId, data });
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
    const fence = fenceFor({ authorization, reads: "traces" });
    const found = [...this.#summaries.values()]
      .filter(
        ({ tenantId, data }) =>
          data.traceId === traceId &&
          fenceAdmits({ fence, tenantId, atMs: data.storageAnchorMs ?? data.occurredAt }),
      )
      .toSorted((left, right) => left.tenantId.localeCompare(right.tenantId))[0];
    return found ? { ...found.data, tenantId: found.tenantId } : null;
  }
}
