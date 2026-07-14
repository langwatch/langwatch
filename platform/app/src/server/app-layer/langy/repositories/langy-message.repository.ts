import type { LangyMessagePart } from "~/server/event-sourcing/pipelines/langy-conversation-processing";

export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface LangyMessageRow {
  id: string;
  role: MessageRole;
  parts: LangyMessagePart[];
  createdAt: Date;
}

export interface LangyMessageRepository {
  findAllByConversation(params: {
    conversationId: string;
    projectId: string;
  }): Promise<LangyMessageRow[]>;
}

export class NullLangyMessageRepository implements LangyMessageRepository {
  async findAllByConversation(): Promise<LangyMessageRow[]> {
    return [];
  }
}
