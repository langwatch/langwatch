import { type Authorization, projectIdsReadBy } from "@langwatch/authorization";

import {
  TraceAnalyticsProjectionRepository,
  type TraceAnalyticsProjectionEntry,
  type TraceAnalyticsProjectionRead,
} from "../trace-analytics-projection.repository.ts";

/**
 * The trace_analytics twin for a process with no ClickHouse. It keeps the last
 * written row per tenant and trace, so a read-back fold recovers its own writes
 * within the process instead of refusing.
 */
export class MemoryTraceAnalyticsRepository extends TraceAnalyticsProjectionRepository {
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
    authorization: Authorization;
    traceId: string;
  }): Promise<TraceAnalyticsProjectionRead | null> {
    for (const tenantId of projectIdsReadBy(input.authorization)) {
      const read = this.rows.get(keyOf(tenantId, input.traceId));
      if (read) return read;
    }
    return null;
  }
}

function keyOf(tenantId: string, traceId: string): string {
  return `${tenantId}:${traceId}`;
}
