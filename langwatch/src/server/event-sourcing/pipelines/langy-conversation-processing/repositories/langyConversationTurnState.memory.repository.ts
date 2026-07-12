import type { Projection } from "../../../";
import { BaseMemoryProjectionStore } from "../../../stores/baseMemoryProjectionStore";
import type { LangyConversationTurnStateRepository } from "./langyConversationTurnState.repository";

export class LangyConversationTurnStateRepositoryMemory<
    ProjectionType extends Projection = Projection,
  >
  extends BaseMemoryProjectionStore<ProjectionType>
  implements LangyConversationTurnStateRepository<ProjectionType>
{
  // aggregateId here is the composite `${conversationId}:${turnId}` fold key.
  protected getKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }
}
