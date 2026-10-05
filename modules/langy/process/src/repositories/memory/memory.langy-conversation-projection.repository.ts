import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import type { LangyConversationStateData } from "@langwatch/langy-contract";

import type { LangyMemoryStore } from "./langy-memory.store.ts";

/** The memory twin of `PrismaLangyConversationProjectionRepository`: one row per conversation. */
export class MemoryLangyConversationProjectionRepository implements StateProjectionStore<LangyConversationStateData> {
  static create(store: LangyMemoryStore): MemoryLangyConversationProjectionRepository {
    return new MemoryLangyConversationProjectionRepository(store);
  }

  private constructor(private readonly memory: LangyMemoryStore) {}

  async get(
    conversationId: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<LangyConversationStateData>> {
    const projectId = String(context.tenantId);
    const row = this.memory.conversations.get(`${projectId}:${conversationId}`);
    return row ? { kind: "folded", projection: row.projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<LangyConversationStateData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    const conversationId = context.aggregateId;
    this.memory.conversations.set(`${projectId}:${conversationId}`, {
      projectId,
      projection: {
        ...projection,
        state: {
          ...projection.state,
          ConversationId: conversationId,
          LastEventOccurredAt: projection.occurredAt,
        },
      },
    });
  }
}
