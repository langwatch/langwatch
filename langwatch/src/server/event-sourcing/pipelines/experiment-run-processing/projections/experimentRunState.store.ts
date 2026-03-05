import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type {
	ExperimentRunState,
	ExperimentRunStateData,
} from "./experimentRunState.foldProjection";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../schemas/constants";
import type { ExperimentRunStateRepository } from "../repositories/experimentRunState.repository";
import { parseExperimentRunKey } from "../utils/compositeKey";

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
      // Extract raw experimentId and runId from the composite aggregate key
      // so that RunId and ExperimentId are always populated consistently,
      // even before the "started" event sets them via apply().
      // This prevents the split-row bug where ExperimentId mutates from ""
      // to the real value between writes.
      const { experimentId, runId } = parseExperimentRunKey(context.aggregateId);
      const stateWithKeys: ExperimentRunStateData = {
        ...state,
        RunId: runId,
        ExperimentId: experimentId,
      };
      const projectionId = context.aggregateId;

      const projection: ExperimentRunState = {
        id: projectionId,
        aggregateId: context.aggregateId,
        tenantId: context.tenantId,
        version: EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,
        data: stateWithKeys,
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
