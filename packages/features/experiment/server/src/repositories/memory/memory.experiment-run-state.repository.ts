import type { Projection } from "@langwatch/eventing";
import { BaseMemoryProjectionStore } from "@langwatch/eventing";
import type { ExperimentRunStateRepository } from "../experiment-run-state.repository";

export class MemoryExperimentRunStateRepository<ProjectionType extends Projection = Projection>
  extends BaseMemoryProjectionStore<ProjectionType>
  implements ExperimentRunStateRepository<ProjectionType>
{
  static create<
    ProjectionType extends Projection = Projection,
  >(): MemoryExperimentRunStateRepository<ProjectionType> {
    return new MemoryExperimentRunStateRepository<ProjectionType>();
  }

  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }
}
