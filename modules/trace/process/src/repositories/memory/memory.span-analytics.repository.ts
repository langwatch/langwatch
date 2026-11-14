import type { SpanAnalyticsRow } from "../../eventing/span-analytics.projection.ts";
import { type SpanAnalyticsKey, SpanAnalyticsRepository } from "../span-analytics.repository.ts";

/** The span_analytics twin for a process with no ClickHouse: keeps every append in memory. */
export class MemorySpanAnalyticsRepository extends SpanAnalyticsRepository {
  readonly appended: SpanAnalyticsRow[] = [];

  static create(): MemorySpanAnalyticsRepository {
    return new MemorySpanAnalyticsRepository();
  }

  async insertRows(input: { rows: SpanAnalyticsRow[]; retentionDays: number }): Promise<void> {
    this.appended.push(...input.rows);
  }

  async existingSpanKeys(input: {
    tenantId: string;
    keys: SpanAnalyticsKey[];
    startTimeFromMs: number;
    startTimeToMs: number;
  }): Promise<SpanAnalyticsKey[]> {
    const wanted = new Set(input.keys.map((key) => `${key.traceId}:${key.spanId}`));
    return this.appended
      .filter(
        (row) =>
          row.tenantId === input.tenantId &&
          row.startTimeUnixMs >= input.startTimeFromMs &&
          row.startTimeUnixMs <= input.startTimeToMs &&
          wanted.has(`${row.traceId}:${row.spanId}`),
      )
      .map((row) => ({ traceId: row.traceId, spanId: row.spanId }));
  }
}
