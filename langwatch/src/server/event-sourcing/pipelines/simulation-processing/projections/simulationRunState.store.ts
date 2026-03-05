import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../projections/projectionStoreContext";
import type {
  SimulationRunState,
  SimulationRunStateData,
} from "./simulationRunState.foldProjection";
import { SIMULATION_PROJECTION_VERSIONS } from "../schemas/constants";
import type { SimulationRunStateRepository } from "../repositories/simulationRunState.repository";

/**
 * Creates a FoldProjectionStore for simulation run state.
 * Dumb read/write -- state IS the data.
 */
export function createSimulationRunStateFoldStore(
  repository: SimulationRunStateRepository,
): FoldProjectionStore<SimulationRunStateData> {
  return {
    async store(
      state: SimulationRunStateData,
      context: ProjectionStoreContext,
    ): Promise<void> {
      const projectionId = context.aggregateId;

      const projection: SimulationRunState = {
        id: projectionId,
        aggregateId: context.aggregateId,
        tenantId: context.tenantId,
        version: SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
        data: state,
      };

      await repository.storeProjection(projection, { tenantId: context.tenantId });
    },

    async get(
      aggregateId: string,
      context: ProjectionStoreContext,
    ): Promise<SimulationRunStateData | null> {
      const projection = await repository.getProjection(aggregateId, {
        tenantId: context.tenantId,
      });

      return (projection?.data as SimulationRunStateData) ?? null;
    },
  };
}
