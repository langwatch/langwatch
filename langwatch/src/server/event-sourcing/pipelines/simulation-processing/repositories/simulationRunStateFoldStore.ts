import type { FoldProjectionStore } from "../../../library/projections/foldProjection.types";
import type { ProjectionStoreContext } from "../../../library/projections/projectionStoreContext";
import type {
  SimulationRunState,
  SimulationRunStateData,
} from "../projections/simulationRunState.foldProjection";
import { SIMULATION_PROJECTION_VERSIONS } from "../schemas/constants";
import { getSimulationRunStateRepository } from "./index";

/**
 * Dumb read/write store for simulation run state.
 * No transformation — state IS the data.
 */
export const simulationRunStateFoldStore: FoldProjectionStore<SimulationRunStateData> = {
  async store(
    state: SimulationRunStateData,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectionId = `simulation_run_state:${context.tenantId}:${state.ScenarioRunId}`;

    const projection: SimulationRunState = {
      id: projectionId,
      aggregateId: context.aggregateId,
      tenantId: context.tenantId,
      version: SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
      data: state,
    };

    const repository = getSimulationRunStateRepository();
    await repository.storeProjection(projection, { tenantId: context.tenantId });
  },

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<SimulationRunStateData | null> {
    const repository = getSimulationRunStateRepository();
    const projection = await repository.getProjection(aggregateId, {
      tenantId: context.tenantId,
    });

    return (projection?.data as SimulationRunStateData) ?? null;
  },
};
