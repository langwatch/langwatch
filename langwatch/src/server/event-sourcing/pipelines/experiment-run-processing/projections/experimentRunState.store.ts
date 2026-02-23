import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type {
	ExperimentRunState,
	ExperimentRunStateData,
} from "./experimentRunState.foldProjection";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../schemas/constants";
import type { ExperimentRunStateRepository } from "../repositories/experimentRunState.repository";

/**
 * Creates a FoldProjectionStore for experiment run state.
 * Dumb read/write — state IS the data.
 */
export function createExperimentRunStateFoldStore(
  repository: ExperimentRunStateRepository,
): FoldProjectionStore<ExperimentRunStateData> {
  return {
    async store(
      state: ExperimentRunStateData,
      context: ProjectionStoreContext,
    ): Promise<void> {
      const projectionId = `experiment_run_state:${context.tenantId}:${state.RunId}`;

      const projection: ExperimentRunState = {
        id: projectionId,
        aggregateId: context.aggregateId,
        tenantId: context.tenantId,
        version: EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,
        data: state,
      };

      await repository.storeProjection(projection, { tenantId: context.tenantId });
    },

    async get(
      aggregateId: string,
      context: ProjectionStoreContext,
    ): Promise<ExperimentRunStateData | null> {
      const projection = await repository.getProjection(aggregateId, {
        tenantId: context.tenantId,
      });

      return (projection?.data as ExperimentRunStateData) ?? null;
    },
  };
}
