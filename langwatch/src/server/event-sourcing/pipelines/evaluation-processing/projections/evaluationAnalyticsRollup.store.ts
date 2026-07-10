import type { EvaluationAnalyticsRollupRepository } from "~/server/app-layer/evaluations/repositories/evaluation-analytics-rollup.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { EvaluationAnalyticsRollupRow } from "./evaluationAnalyticsRollup.mapProjection";

/**
 * Thin AppendStore adapter for the `evaluation_analytics_rollup` map
 * projection (ADR-034 Phase 6 — eval mirror of
 * `TraceAnalyticsRollupAppendStore`). Pulls per-tenant retention off the
 * context and stamps it onto the row's `_retention_days` column, then
 * delegates to the repository.
 */
export class EvaluationAnalyticsRollupAppendStore
  implements AppendStore<EvaluationAnalyticsRollupRow>
{
  constructor(private readonly repo: EvaluationAnalyticsRollupRepository) {}

  async append(
    record: EvaluationAnalyticsRollupRow,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const retentionDays =
      context.retentionPolicy?.traces ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.repo.insertRow(record, retentionDays);
  }
}
