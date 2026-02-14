import type { FoldProjectionStore } from "../../../library/projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../library/projections/projectionStoreContext";
import type { EvaluationStateFoldState } from "../projections/evaluationState.foldProjection";
import type {
  EvaluationState,
  EvaluationStateData,
} from "../projections/evaluationState.foldProjection";
import { EVALUATION_PROJECTION_VERSIONS } from "../schemas/constants";
import { IdUtils } from "../utils/id.utils";
import { getEvaluationStateRepository } from "./index";

/**
 * FoldProjectionStore wrapper for evaluation state.
 *
 * Adapts the existing EvaluationStateRepository to the FoldProjectionStore
 * interface by converting between EvaluationStateFoldState and the
 * Projection<EvaluationStateData> format expected by the repository.
 */
export const evaluationStateFoldStore: FoldProjectionStore<EvaluationStateFoldState> = {
  async store(
    state: EvaluationStateFoldState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectionId = state.firstEventTimestamp
      ? IdUtils.generateDeterministicEvaluationStateId(
          String(context.tenantId),
          state.evaluationId,
          state.firstEventTimestamp,
        )
      : `evaluation_state:${context.tenantId}:${state.evaluationId}`;

    const data: EvaluationStateData = {
      EvaluationId: state.evaluationId,
      EvaluatorId: state.evaluatorId,
      EvaluatorType: state.evaluatorType,
      EvaluatorName: state.evaluatorName,
      TraceId: state.traceId,
      IsGuardrail: state.isGuardrail,
      Status: state.status,
      Score: state.score,
      Passed: state.passed,
      Label: state.label,
      Details: state.details,
      Error: state.error,
      ScheduledAt: state.scheduledAt,
      StartedAt: state.startedAt,
      CompletedAt: state.completedAt,
    };

    const projection: EvaluationState = {
      id: projectionId,
      aggregateId: context.aggregateId,
      tenantId: context.tenantId,
      version: EVALUATION_PROJECTION_VERSIONS.STATE,
      data,
    };

    const repository = getEvaluationStateRepository();
    await repository.storeProjection(projection, { tenantId: context.tenantId });
  },

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<EvaluationStateFoldState | null> {
    const repository = getEvaluationStateRepository();
    const projection = await repository.getProjection(aggregateId, {
      tenantId: context.tenantId,
    });

    if (!projection) {
      return null;
    }

    const data = projection.data as EvaluationStateData;

    return {
      evaluationId: data.EvaluationId,
      evaluatorId: data.EvaluatorId,
      evaluatorType: data.EvaluatorType,
      evaluatorName: data.EvaluatorName,
      traceId: data.TraceId,
      isGuardrail: data.IsGuardrail,
      status: data.Status,
      score: data.Score,
      passed: data.Passed,
      label: data.Label,
      details: data.Details,
      error: data.Error,
      scheduledAt: data.ScheduledAt,
      startedAt: data.StartedAt,
      completedAt: data.CompletedAt,
      // Cannot reconstruct from stored data; rebuild replays all events
      firstEventTimestamp: null,
    };
  },
};
