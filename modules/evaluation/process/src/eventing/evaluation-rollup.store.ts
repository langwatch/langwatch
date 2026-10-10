import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { AppendStore, ProjectionStoreContext } from "@langwatch/eventing";

import type { EvaluationAnalyticsRollupRow } from "./evaluation-analytics-rollup.projection.ts";

/**
 * Thin AppendStore adapter for the `evaluation_analytics_rollup` map
 * projection (ADR-034 Phase 6, mirroring `TraceAnalyticsRollupAppendStore`).
 * Stamps per-tenant retention onto the row's `_retention_days` column.
 */
export class EvaluationAnalyticsRollupStore implements AppendStore<EvaluationAnalyticsRollupRow> {
  static create(input: {
    analytics: Pick<AnalyticsApi, "appendEvaluationAnalyticsRollup">;
    defaultRetentionDays: () => number;
  }): EvaluationAnalyticsRollupStore {
    return new EvaluationAnalyticsRollupStore(input.analytics, input.defaultRetentionDays);
  }

  private constructor(
    private readonly analytics: Pick<AnalyticsApi, "appendEvaluationAnalyticsRollup">,
    private readonly defaultRetentionDays: () => number,
  ) {}

  async append(row: EvaluationAnalyticsRollupRow, context: ProjectionStoreContext): Promise<void> {
    const retentionDays = context.retentionPolicy?.traces ?? this.defaultRetentionDays();
    await this.analytics.appendEvaluationAnalyticsRollup({ row, retentionDays });
  }
}
