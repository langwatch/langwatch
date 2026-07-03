import type { ExperimentAnalyticsRollupRepository } from "~/server/app-layer/experiments/repositories/experiment-analytics-rollup.repository";
import { BaseAnalyticsRollupAppendStore } from "../../shared/analyticsStoreBase";
import type { ExperimentAnalyticsRollupRow } from "./experimentAnalyticsRollup.mapProjection";

/**
 * Thin AppendStore adapter for the `experiment_analytics_rollup` map projection
 * (ADR-034 Phase 7).
 */
export class ExperimentAnalyticsRollupAppendStore extends BaseAnalyticsRollupAppendStore<ExperimentAnalyticsRollupRow> {
  constructor(repo: ExperimentAnalyticsRollupRepository) {
    super(repo, { retentionCategory: "experiments" });
  }
}
