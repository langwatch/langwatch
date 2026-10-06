import { langyMessagePartSchema } from "@langwatch/langy-contract";
import { Temporal, toEpochMs } from "@langwatch/time";

import {
  LangyMessageRepository,
  type LangyMessageRow,
  type MessageRole,
} from "../langy-message.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

/** The memory twin of `PrismaLangyMessageRepository`, over the rows the message map wrote. */
export class MemoryLangyMessageRepository extends LangyMessageRepository {
  static create(store: LangyMemoryStore): MemoryLangyMessageRepository {
    return new MemoryLangyMessageRepository(store);
  }

  private constructor(private readonly store: LangyMemoryStore) {
    super();
  }

  async findAllByConversation(params: {
    conversationId: string;
    projectId: string;
  }): Promise<LangyMessageRow[]> {
    return [...this.store.messages.values()]
      .filter(
        (row) =>
          row.projectId === params.projectId && row.record.ConversationId === params.conversationId,
      )
      .map((row) => row.record)
      .toSorted((a, b) => a.CreatedAt - b.CreatedAt || compareIds(a.MessageId, b.MessageId))
      .map((record) => ({
        id: record.MessageId,
        role: record.Role as MessageRole,
        parts: langyMessagePartSchema.array().parse(record.Parts),
        createdAt: Temporal.Instant.fromEpochMilliseconds(toEpochMs(record.CreatedAt)),
      }));
  }
}

function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
