import type { Projection } from "../../../";
import { BaseMemoryProjectionStore } from "../../../stores/baseMemoryProjectionStore";
import type { LangyConversationStateRepository } from "./langyConversationState.repository";

export class LangyConversationStateRepositoryMemory<
    ProjectionType extends Projection = Projection,
  >
  extends BaseMemoryProjectionStore<ProjectionType>
  implements LangyConversationStateRepository<ProjectionType>
{
  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }
}
