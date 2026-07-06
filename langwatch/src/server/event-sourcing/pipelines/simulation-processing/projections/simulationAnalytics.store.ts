import type { SimulationAnalyticsRepository } from "~/server/app-layer/scenarios/repositories/simulation-analytics.repository";
import { BaseAnalyticsFoldStore } from "../../shared/analyticsStoreBase";
import {
  projectSimulationAnalyticsStateToRow,
  SIMULATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  type SimulationAnalyticsData,
} from "./simulationAnalytics.foldProjection";

/**
 * `FoldProjectionStore` adapter for the slim `simulation_analytics` fold
 * (ADR-034 Phase 7 — scenarios mirror of `TraceAnalyticsStore` /
 * `EvaluationAnalyticsStore`).
 *
 * Skips empty rows (no scenarioRunId stamped yet), falls back to the
 * aggregateId when the state has no scenarioRunId, stamps the per-tenant
 * retention onto the record, and projects the in-memory
 * `SimulationAnalyticsData` accumulator into the slim row at write time.
 */
export class SimulationAnalyticsStore extends BaseAnalyticsFoldStore<
  SimulationAnalyticsData,
  ReturnType<typeof projectSimulationAnalyticsStateToRow>
> {
  constructor(repo: SimulationAnalyticsRepository) {
    super(repo, {
      hasPersistableSignal,
      stampAggregateId: (state, aggregateId) =>
        state.scenarioRunId
          ? state
          : { ...state, scenarioRunId: aggregateId },
      retentionCategory: "scenarios",
      versionLatest: SIMULATION_ANALYTICS_PROJECTION_VERSION_LATEST,
      project: projectSimulationAnalyticsStateToRow,
    });
  }
}

/**
 * Skip rows whose state has no observable signal yet — the fold may have run
 * once with a half-formed pre-queued state. Persisting it would churn the
 * slim table for runs that never reach a terminal status.
 *
 * The conservative branch (no scenarioRunId) is always a no-op so the store
 * cannot persist a row whose primary key is empty.
 */
function hasPersistableSignal(state: SimulationAnalyticsData): boolean {
  if (!state.scenarioRunId) return false;
  return true;
}
