import type { LangyMessagePart } from "@langwatch/langy-contract";
import type { Instant } from "@langwatch/time";

export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface LangyMessageRow {
  id: string;
  role: MessageRole;
  parts: LangyMessagePart[];
  createdAt: Instant;
}

export abstract class LangyMessageRepository {
  abstract findAllByConversation(params: {
    conversationId: string;
    projectId: string;
  }): Promise<LangyMessageRow[]>;
}

export class NullLangyMessageRepository extends LangyMessageRepository {
  async findAllByConversation(): Promise<LangyMessageRow[]> {
    return [];
  }
}
