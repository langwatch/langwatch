import {
  TraceAnalyticsProjectionPort,
  type TraceAnalyticsProjectionEntry,
  type TraceAnalyticsProjectionRead,
} from "../projection/trace-analytics-projection.repository.ts";

/**
 * The trace_analytics twin for a process with no ClickHouse. It keeps the last
 * written row per tenant and trace, so a read-back fold recovers its own writes
 * within the process instead of refusing.
 */
export class MemoryTraceAnalyticsRepository extends TraceAnalyticsProjectionPort {
  private readonly rows = new Map<string, TraceAnalyticsProjectionRead>();

  static create(): MemoryTraceAnalyticsRepository {
    return new MemoryTraceAnalyticsRepository();
  }

  async upsert(entry: TraceAnalyticsProjectionEntry): Promise<void> {
    this.rows.set(keyOf(entry.row.tenantId, entry.row.traceId), {
      row: entry.row,
      appliedEventIds: [...entry.appliedEventIds],
    });
  }

  override async upsertBatch(entries: TraceAnalyticsProjectionEntry[]): Promise<void> {
    for (const entry of entries) await this.upsert(entry);
  }

  async findByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<TraceAnalyticsProjectionRead | null> {
    return this.rows.get(keyOf(input.tenantId, input.traceId)) ?? null;
  }
}

function keyOf(tenantId: string, traceId: string): string {
  return `${tenantId}:${traceId}`;
}
