import type { AppendStore, ProjectionStoreContext } from "@langwatch/eventing";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { EvaluationAnalyticsRollupRow } from "../../projections/evaluation-analytics-rollup.projection";

/**
 * Thin AppendStore adapter for the `evaluation_analytics_rollup` map
 * projection (ADR-034 Phase 6 — eval mirror of
 * `TraceAnalyticsRollupAppendStore`). Pulls per-tenant retention off the
 * context and stamps it onto the row's `_retention_days` column, then
 * delegates to the repository.
 */
export class EvaluationAnalyticsRollupStore implements AppendStore<EvaluationAnalyticsRollupRow> {
  static create(input: {
    analytics: AnalyticsService;
    defaultRetentionDays: number;
  }): EvaluationAnalyticsRollupStore {
    return new EvaluationAnalyticsRollupStore(input.analytics, input.defaultRetentionDays);
  }

  private constructor(
    private readonly analytics: AnalyticsService,
    private readonly defaultRetentionDays: number,
  ) {}

  async append(row: EvaluationAnalyticsRollupRow, context: ProjectionStoreContext): Promise<void> {
    const retentionDays = context.retentionPolicy?.traces ?? this.defaultRetentionDays;
    await this.analytics.appendEvaluationAnalyticsRollup({ row, retentionDays });
  }
}
