import type { AppendStore, ProjectionStoreContext } from "@langwatch/eventing";
import type { TraceAnalyticsRollupRow } from "../../projections/trace-rollup.projection";
import { TraceAnalyticsRollupPort } from "../../ports/trace-analytics-rollup.port";

/**
 * Thin AppendStore adapter for the trace_analytics_rollup map projection
 * (ADR-034 Phase 1). Pulls per-tenant retention off the context and stamps it
 * onto the row's `_retention_days` column, then delegates to the repository.
 */
export class TraceAnalyticsRollupStore implements AppendStore<TraceAnalyticsRollupRow> {
  private constructor(
    private readonly storage: TraceAnalyticsRollupPort,
    private readonly defaultRetentionDays: number,
  ) {}

  static create(options: {
    storage: TraceAnalyticsRollupPort;
    defaultRetentionDays: number;
  }): TraceAnalyticsRollupStore {
    return new TraceAnalyticsRollupStore(options.storage, options.defaultRetentionDays);
  }

  async append(record: TraceAnalyticsRollupRow, context: ProjectionStoreContext): Promise<void> {
    const retentionDays = context.retentionPolicy?.traces ?? this.defaultRetentionDays;
    await this.storage.insertRow({ row: record, retentionDays });
  }
}
