import type { FoldProjectionStore } from "../../../library/projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../library/projections/projectionStoreContext";
import type {
  ExperimentRunState,
  ExperimentRunStateData,
} from "../projections/experimentRunState.foldProjection";
import { EXPERIMENT_RUN_PROJECTION_VERSIONS } from "../schemas/constants";
import { getExperimentRunStateRepository } from "./index";

/**
 * Dumb read/write store for experiment run state.
 * No transformation — state IS the data.
 */
export const experimentRunStateFoldStore: FoldProjectionStore<ExperimentRunStateData> = {
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

    const repository = getExperimentRunStateRepository();
    await repository.storeProjection(projection, { tenantId: context.tenantId });
  },

  async storeBatch(
    entries: Array<{ state: ExperimentRunStateData; context: ProjectionStoreContext }>,
  ): Promise<void> {
    const projections: ExperimentRunState[] = entries.map(({ state, context }) => {
      const projectionId = `experiment_run_state:${context.tenantId}:${state.RunId}`;
      return {
        id: projectionId,
        aggregateId: context.aggregateId,
        tenantId: context.tenantId,
        version: EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,
        data: state,
      };
    });

    if (projections.length > 0) {
      const repository = getExperimentRunStateRepository();
      await repository.storeProjectionBatch(projections, {
        tenantId: entries[0]!.context.tenantId,
      });
    }
  },

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<ExperimentRunStateData | null> {
    const repository = getExperimentRunStateRepository();
    const projection = await repository.getProjection(aggregateId, {
      tenantId: context.tenantId,
    });

    return (projection?.data as ExperimentRunStateData) ?? null;
  },
};
