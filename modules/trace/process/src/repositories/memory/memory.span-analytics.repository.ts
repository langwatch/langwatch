import type { SpanAnalyticsRow } from "../../eventing/span-analytics.projection.ts";
import { SpanAnalyticsRepository } from "../span-analytics.repository.ts";

/** The span_analytics twin for a process with no ClickHouse: keeps every append in memory. */
export class MemorySpanAnalyticsRepository extends SpanAnalyticsRepository {
  readonly appended: SpanAnalyticsRow[] = [];

  static create(): MemorySpanAnalyticsRepository {
    return new MemorySpanAnalyticsRepository();
  }

  async insertRows(input: { rows: SpanAnalyticsRow[]; retentionDays: number }): Promise<void> {
    this.appended.push(...input.rows);
  }
}
