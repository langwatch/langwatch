import type { FoldProjectionStore } from "../../../library/projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../library/projections/projectionStoreContext";
import type { ExperimentRunFoldState } from "../projections/experimentRunState.foldProjection";
import type { ExperimentRunStateData } from "../projections/experimentRunState.foldProjection";
import type { ExperimentRunState } from "../projections/experimentRunState.foldProjection";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../schemas/constants";
import { getExperimentRunStateRepository } from "./index";

/**
 * Converts an ExperimentRunFoldState into ExperimentRunStateData for persistence.
 * Computes derived fields (progress, completedCount, avgScore, passRate) from
 * the intermediate fold state.
 */
function foldStateToData(state: ExperimentRunFoldState): ExperimentRunStateData {
  const progress = state.completedCells.size + state.failedCells.size;
  const completedCount = state.completedCells.size;
  const failedCount = state.failedCells.size;
  const avgScore =
    state.scores.length > 0
      ? state.scores.reduce((sum, s) => sum + s, 0) / state.scores.length
      : null;
  const passRate =
    state.passFailCount > 0 ? state.passedCount / state.passFailCount : null;

  return {
    RunId: state.runId,
    ExperimentId: state.experimentId,
    WorkflowVersionId: state.workflowVersionId,
    Total: state.total,
    Progress: progress,
    CompletedCount: completedCount,
    FailedCount: failedCount,
    TotalCost: state.hasCostData ? state.totalCost : null,
    TotalDurationMs: state.hasDurationData ? state.totalDurationMs : null,
    AvgScore: avgScore,
    PassRate: passRate,
    Targets: JSON.stringify(state.targets),
    CreatedAt: state.createdAt,
    UpdatedAt: state.updatedAt,
    FinishedAt: state.finishedAt,
    StoppedAt: state.stoppedAt,
  };
}

/**
 * FoldProjectionStore wrapper for experiment run state.
 *
 * Adapts the existing ExperimentRunStateRepository to the FoldProjectionStore
 * interface by converting between ExperimentRunFoldState and the Projection<ExperimentRunStateData>
 * format expected by the repository.
 */
export const experimentRunStateFoldStore: FoldProjectionStore<ExperimentRunFoldState> = {
  async store(
    state: ExperimentRunFoldState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const data = foldStateToData(state);
    const projectionId = `experiment_run_state:${context.tenantId}:${state.runId}`;

    const projection: ExperimentRunState = {
      id: projectionId,
      aggregateId: context.aggregateId,
      tenantId: context.tenantId,
      version: EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,
      data,
    };

    const repository = getExperimentRunStateRepository();
    await repository.storeProjection(projection, { tenantId: context.tenantId });
  },

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<ExperimentRunFoldState | null> {
    const repository = getExperimentRunStateRepository();
    const projection = await repository.getProjection(aggregateId, {
      tenantId: context.tenantId,
    });

    if (!projection) {
      return null;
    }

    const data = projection.data as ExperimentRunStateData;

    // Reconstruct fold state from stored data.
    // Note: intermediate fields (completedCells, failedCells, scores) cannot be
    // fully reconstructed from the projection data alone. For rebuild strategy
    // (replay all events), this is fine because get() is only called for
    // incremental mode. For rebuild mode the init() + apply() loop is used.
    return {
      runId: data.RunId,
      experimentId: data.ExperimentId,
      workflowVersionId: data.WorkflowVersionId,
      total: data.Total,
      targets: data.Targets ? JSON.parse(data.Targets) : [],
      totalCost: data.TotalCost ?? 0,
      totalDurationMs: data.TotalDurationMs ?? 0,
      hasCostData: data.TotalCost != null,
      hasDurationData: data.TotalDurationMs != null,
      createdAt: data.CreatedAt,
      updatedAt: data.UpdatedAt,
      finishedAt: data.FinishedAt,
      stoppedAt: data.StoppedAt,
      // These cannot be reconstructed from the projection data.
      // Rebuild strategy replays all events so this is acceptable.
      completedCells: new Set<string>(),
      failedCells: new Set<string>(),
      scores: [],
      passedCount: 0,
      passFailCount: 0,
    };
  },
};
