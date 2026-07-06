import type { ExperimentAnalyticsRepository } from "~/server/app-layer/experiments/repositories/experiment-analytics.repository";
import { BaseAnalyticsFoldStore } from "../../shared/analyticsStoreBase";
import {
  EXPERIMENT_ANALYTICS_PROJECTION_VERSION_LATEST,
  type ExperimentAnalyticsData,
  projectExperimentAnalyticsStateToRow,
} from "./experimentAnalytics.foldProjection";

/**
 * `FoldProjectionStore` adapter for the slim `experiment_analytics` fold
 * (ADR-034 Phase 7 — experiments mirror of `EvaluationAnalyticsStore`).
 */
export class ExperimentAnalyticsStore extends BaseAnalyticsFoldStore<
  ExperimentAnalyticsData,
  ReturnType<typeof projectExperimentAnalyticsStateToRow>
> {
  constructor(repo: ExperimentAnalyticsRepository) {
    super(repo, {
      hasPersistableSignal,
      stampAggregateId: (state, aggregateId) =>
        state.runId ? state : { ...state, runId: aggregateId },
      retentionCategory: "experiments",
      versionLatest: EXPERIMENT_ANALYTICS_PROJECTION_VERSION_LATEST,
      project: projectExperimentAnalyticsStateToRow,
    });
  }
}

function hasPersistableSignal(state: ExperimentAnalyticsData): boolean {
  if (!state.runId) return false;
  return true;
}
