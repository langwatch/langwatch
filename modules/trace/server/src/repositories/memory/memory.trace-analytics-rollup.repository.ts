import { TraceAnalyticsRollupRepository } from "../projection/trace-analytics-rollup.repository.ts";
import type { TraceAnalyticsRollupRow } from "../../projections/trace-rollup.projection.ts";

/**
 * The trace_analytics_rollup twin for a process with no ClickHouse: it accepts
 * every append and keeps it in memory, so a fold that rolls up runs to
 * completion without a durable store behind it.
 */
export class MemoryTraceAnalyticsRollupRepository extends TraceAnalyticsRollupRepository {
  readonly appended: TraceAnalyticsRollupRow[] = [];

  static create(): MemoryTraceAnalyticsRollupRepository {
    return new MemoryTraceAnalyticsRollupRepository();
  }

  async insertRow(input: { row: TraceAnalyticsRollupRow; retentionDays: number }): Promise<void> {
    this.appended.push(input.row);
  }

  async insertRows(input: {
    rows: TraceAnalyticsRollupRow[];
    retentionDays: number;
  }): Promise<void> {
    this.appended.push(...input.rows);
  }
}
