import type { Projection } from "../../../";
import { BaseMemoryProjectionStore } from "../../../stores/baseMemoryProjectionStore";
import type { SimulationRunStateRepository } from "./simulationRunState.repository";

export class SimulationRunStateRepositoryMemory<
    ProjectionType extends Projection = Projection,
  >
  extends BaseMemoryProjectionStore<ProjectionType>
  implements SimulationRunStateRepository<ProjectionType>
{
  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }
}
