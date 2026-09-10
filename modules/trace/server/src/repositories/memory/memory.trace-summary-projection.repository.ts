import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  TraceSummaryProjectionPort,
  type TraceSummaryProjectionEntry,
} from "../../ports/trace-summary-projection.port.ts";

/**
 * The trace_summaries twin for a process with no ClickHouse. It keeps the last
 * written summary per tenant and trace, so a fold that reads its own writes
 * back runs to completion without a durable store behind it.
 */
export class MemoryTraceSummaryProjectionRepository extends TraceSummaryProjectionPort {
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

  async findByTraceId(input: { tenantId: string; traceId: string }): Promise<TraceSummaryData | null> {
    return this.summaries.get(`${input.tenantId}:${input.traceId}`) ?? null;
  }
}
