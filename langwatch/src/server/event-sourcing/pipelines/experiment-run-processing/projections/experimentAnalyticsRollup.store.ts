import type { ExperimentAnalyticsRollupRepository } from "~/server/app-layer/experiments/repositories/experiment-analytics-rollup.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { AppendStore } from "../../../projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type { ExperimentAnalyticsRollupRow } from "./experimentAnalyticsRollup.mapProjection";

/**
 * Thin AppendStore adapter for the `experiment_analytics_rollup` map projection
 * (ADR-034 Phase 7).
 */
export class ExperimentAnalyticsRollupAppendStore
  implements AppendStore<ExperimentAnalyticsRollupRow>
{
  constructor(private readonly repo: ExperimentAnalyticsRollupRepository) {}

  async append(
    record: ExperimentAnalyticsRollupRow,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const retentionDays =
      context.retentionPolicy?.experiments ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    await this.repo.insertRow(record, retentionDays);
  }
}
