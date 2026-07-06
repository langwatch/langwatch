import type { ExperimentAnalyticsRepository } from "~/server/app-layer/experiments/repositories/experiment-analytics.repository";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import {
  EXPERIMENT_ANALYTICS_PROJECTION_VERSION_LATEST,
  type ExperimentAnalyticsData,
  projectExperimentAnalyticsStateToRow,
} from "./experimentAnalytics.foldProjection";

/**
 * `FoldProjectionStore` adapter for the slim `experiment_analytics` fold
 * (ADR-034 Phase 7 — experiments mirror of `EvaluationAnalyticsStore`).
 */
export class ExperimentAnalyticsStore
  implements FoldProjectionStore<ExperimentAnalyticsData>
{
  constructor(private readonly repo: ExperimentAnalyticsRepository) {}

  async store(
    state: ExperimentAnalyticsData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (!hasPersistableSignal(state)) return;
    const stateWithId: ExperimentAnalyticsData = state.runId
      ? state
      : { ...state, runId: String(context.aggregateId) };
    const retentionDays =
      context.retentionPolicy?.experiments ?? PLATFORM_DEFAULT_RETENTION_DAYS;
    const row = projectExperimentAnalyticsStateToRow({
      state: stateWithId,
      tenantId: String(context.tenantId),
      version: EXPERIMENT_ANALYTICS_PROJECTION_VERSION_LATEST,
    });
    await this.repo.upsert(row, retentionDays);
  }

  async storeBatch(
    entries: Array<{
      state: ExperimentAnalyticsData;
      context: ProjectionStoreContext;
    }>,
  ): Promise<void> {
    const batchRows = entries
      .filter(({ state }) => hasPersistableSignal(state))
      .map(({ state, context }) => {
        const stateWithId: ExperimentAnalyticsData = state.runId
          ? state
          : { ...state, runId: String(context.aggregateId) };
        return {
          row: projectExperimentAnalyticsStateToRow({
            state: stateWithId,
            tenantId: String(context.tenantId),
            version: EXPERIMENT_ANALYTICS_PROJECTION_VERSION_LATEST,
          }),
          retentionDays:
            context.retentionPolicy?.experiments ??
            PLATFORM_DEFAULT_RETENTION_DAYS,
        };
      });

    if (batchRows.length === 0) return;

    if (this.repo.upsertBatch) {
      await this.repo.upsertBatch(batchRows);
    } else {
      await Promise.all(
        batchRows.map(({ row, retentionDays }) =>
          this.repo.upsert(row, retentionDays),
        ),
      );
    }
  }

  async get(
    _aggregateId: string,
    _context: ProjectionStoreContext,
  ): Promise<ExperimentAnalyticsData | null> {
    return null;
  }
}

function hasPersistableSignal(state: ExperimentAnalyticsData): boolean {
  if (!state.runId) return false;
  return true;
}
