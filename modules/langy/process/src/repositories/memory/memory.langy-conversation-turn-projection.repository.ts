import type {
  ProjectionStoreContext,
  StateProjectionStore,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import {
  LANGY_CONVERSATION_TURN_STATUS,
  type LangyConversationTurnData,
  parseConversationTurnKey,
} from "@langwatch/langy-contract";

import type { LangyMemoryStore } from "./langy-memory.store.ts";

const TURN_STATUSES: ReadonlySet<string> = new Set(Object.values(LANGY_CONVERSATION_TURN_STATUS));

/** The memory twin of `PrismaLangyConversationTurnProjectionRepository`: one row per turn. */
export class MemoryLangyConversationTurnProjectionRepository implements StateProjectionStore<LangyConversationTurnData> {
  static create(store: LangyMemoryStore): MemoryLangyConversationTurnProjectionRepository {
    return new MemoryLangyConversationTurnProjectionRepository(store);
  }

  private constructor(private readonly memory: LangyMemoryStore) {}

  async get(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<LangyConversationTurnData>> {
    const { conversationId, turnId } = parseConversationTurnKey(key);
    const row = this.memory.turns.get(`${String(context.tenantId)}:${conversationId}:${turnId}`);
    return row ? { kind: "folded", projection: row.projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<LangyConversationTurnData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    const { conversationId, turnId } = parseConversationTurnKey(context.key ?? context.aggregateId);
    // The column is text; the live write refuses a status this build cannot read back.
    if (!TURN_STATUSES.has(projection.state.Status)) {
      throw new Error(`Unrecognised Langy turn status: ${projection.state.Status}`);
    }
    this.memory.turns.set(`${projectId}:${conversationId}:${turnId}`, {
      projectId,
      projection: {
        ...projection,
        state: {
          ...projection.state,
          ConversationId: conversationId,
          TurnId: turnId,
          LastEventOccurredAt: projection.occurredAt,
        },
      },
    });
  }
}
