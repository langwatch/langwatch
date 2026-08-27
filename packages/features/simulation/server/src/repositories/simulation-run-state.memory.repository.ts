import type { Projection } from "@langwatch/eventing";
import { BaseMemoryProjectionStore } from "@langwatch/eventing";
import type { SimulationRunStateRepository } from "./simulation-run-state.repository";

export class SimulationRunStateRepositoryMemory<ProjectionType extends Projection = Projection>
  extends BaseMemoryProjectionStore<ProjectionType>
  implements SimulationRunStateRepository<ProjectionType>
{
  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }
}
