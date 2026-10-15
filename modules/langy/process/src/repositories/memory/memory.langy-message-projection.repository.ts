import type { AppendStore, ProjectionStoreContext } from "@langwatch/eventing";
import type { LangyMessageProjectionRecord } from "@langwatch/langy-contract";

import type { LangyMemoryStore } from "./langy-memory.store.ts";

/** The memory twin of `PrismaLangyMessageProjectionRepository`: an upsert per message id. */
export class MemoryLangyMessageProjectionRepository implements AppendStore<LangyMessageProjectionRecord> {
  static create(store: LangyMemoryStore): MemoryLangyMessageProjectionRepository {
    return new MemoryLangyMessageProjectionRepository(store);
  }

  private constructor(private readonly store: LangyMemoryStore) {}

  async append(
    record: LangyMessageProjectionRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    this.store.messages.set(`${projectId}:${record.ConversationId}:${record.MessageId}`, {
      projectId,
      record: { ...record },
    });
  }
}
