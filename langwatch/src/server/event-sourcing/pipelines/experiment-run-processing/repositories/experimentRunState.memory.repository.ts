import type { Projection } from "../../../";
import { BaseMemoryProjectionStore } from "../../../stores/baseMemoryProjectionStore";
import type { ExperimentRunStateRepository } from "./experimentRunState.repository";

export class ExperimentRunStateRepositoryMemory<
    ProjectionType extends Projection = Projection,
  >
  extends BaseMemoryProjectionStore<ProjectionType>
  implements ExperimentRunStateRepository<ProjectionType>
{
  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }
}
