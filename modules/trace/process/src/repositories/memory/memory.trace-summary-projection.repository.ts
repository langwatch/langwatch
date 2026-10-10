import { type Authorization, projectIdsReadBy } from "@langwatch/authorization";
import type { TraceSummaryData } from "@langwatch/trace-contract";

import {
  TraceSummaryProjectionRepository,
  type TraceSummaryProjectionEntry,
} from "../trace-summary-projection.repository.ts";

/**
 * The trace_summaries twin for a process with no ClickHouse. It keeps the last
 * written summary per tenant and trace, so a fold that reads its own writes
 * back runs to completion without a durable store behind it.
 */
export class MemoryTraceSummaryProjectionRepository extends TraceSummaryProjectionRepository {
  private readonly summaries = new Map<string, TraceSummaryData>();

  static create(): MemoryTraceSummaryProjectionRepository {
    return new MemoryTraceSummaryProjectionRepository();
  }

  async upsert(entry: TraceSummaryProjectionEntry): Promise<void> {
    this.summaries.set(`${entry.tenantId}:${entry.data.traceId ?? ""}`, entry.data);
  }

  override async upsertBatch(entries: TraceSummaryProjectionEntry[]): Promise<void> {
    for (const entry of entries) await this.upsert(entry);
  }

  async findByTraceId(input: {
    authorization: Authorization;
    traceId: string;
  }): Promise<TraceSummaryData | null> {
    for (const tenantId of projectIdsReadBy(input.authorization)) {
      const summary = this.summaries.get(`${tenantId}:${input.traceId}`);
      if (summary) return summary;
    }
    return null;
  }
}
