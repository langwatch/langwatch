import type { Projection } from "@langwatch/eventing";
import { BaseMemoryProjectionStore } from "@langwatch/eventing";
import type { SimulationRunStateRepository } from "../simulation-run-state.repository";

export class MemorySimulationRunStateRepository<ProjectionType extends Projection = Projection>
  extends BaseMemoryProjectionStore<ProjectionType>
  implements SimulationRunStateRepository<ProjectionType>
{
  static create<
    ProjectionType extends Projection = Projection,
  >(): MemorySimulationRunStateRepository<ProjectionType> {
    return new MemorySimulationRunStateRepository<ProjectionType>();
  }

  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }
}

export { MemorySimulationRunStateRepository as SimulationRunStateRepositoryMemory };
