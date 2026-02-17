import type { FoldProjectionStore } from "../../../library/projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../library/projections/projectionStoreContext";
import type {
  EvaluationState,
  EvaluationStateData,
} from "../projections/evaluationState.foldProjection";
import { EVALUATION_PROJECTION_VERSIONS } from "../schemas/constants";
import { IdUtils } from "../utils/id.utils";
import { getEvaluationStateRepository } from "./index";

/**
 * Dumb read/write store for evaluation state.
 * No transformation — state IS the data.
 */
export const evaluationStateFoldStore: FoldProjectionStore<EvaluationStateData> = {
  async store(
    state: EvaluationStateData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectionId = state.ScheduledAt
      ? IdUtils.generateDeterministicEvaluationStateId(
          String(context.tenantId),
          state.EvaluationId,
          state.ScheduledAt,
        )
      : `evaluation_state:${context.tenantId}:${state.EvaluationId}`;

    const projection: EvaluationState = {
      id: projectionId,
      aggregateId: context.aggregateId,
      tenantId: context.tenantId,
      version: EVALUATION_PROJECTION_VERSIONS.STATE,
      data: state,
    };

    const repository = getEvaluationStateRepository();
    await repository.storeProjection(projection, { tenantId: context.tenantId });
  },

  async storeBatch(
    entries: Array<{ state: EvaluationStateData; context: ProjectionStoreContext }>,
  ): Promise<void> {
    const projections: EvaluationState[] = entries.map(({ state, context }) => {
      const projectionId = state.ScheduledAt
        ? IdUtils.generateDeterministicEvaluationStateId(
            String(context.tenantId),
            state.EvaluationId,
            state.ScheduledAt,
          )
        : `evaluation_state:${context.tenantId}:${state.EvaluationId}`;
      return {
        id: projectionId,
        aggregateId: context.aggregateId,
        tenantId: context.tenantId,
        version: EVALUATION_PROJECTION_VERSIONS.STATE,
        data: state,
      };
    });

    if (projections.length > 0) {
      const repository = getEvaluationStateRepository();
      await repository.storeProjectionBatch(projections, {
        tenantId: entries[0]!.context.tenantId,
      });
    }
  },

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<EvaluationStateData | null> {
    const repository = getEvaluationStateRepository();
    const projection = await repository.getProjection(aggregateId, {
      tenantId: context.tenantId,
    });

    return (projection?.data as EvaluationStateData) ?? null;
  },
};
