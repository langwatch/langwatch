import type { Projection } from "@langwatch/eventing";
import { BaseMemoryProjectionStore } from "@langwatch/eventing";
import type { SuiteRunStateRepository } from "./suiteRunState.repository";

export class SuiteRunStateRepositoryMemory<
    ProjectionType extends Projection = Projection,
  >
  extends BaseMemoryProjectionStore<ProjectionType>
  implements SuiteRunStateRepository<ProjectionType>
{
  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }
}
