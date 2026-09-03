import { LangyConversationNotFoundError } from "@langwatch/langy-contract";
import type { LangyConversationRepository } from "../repositories/langy-conversation-projection.repository";
import type {
  LangyMessageRepository,
  LangyMessageRow,
} from "../repositories/langy-message.repository";

export type {
  LangyMessageRepository,
  LangyMessageRow,
  MessageRole,
} from "../repositories/langy-message.repository";

export interface LangyMessageRecord {
  id: string;
  role: LangyMessageRow["role"];
  content: string;
}

export interface LangyTrustedMessageReader {
  /**
   * Internal automation may read a transcript after its triggering event has
   * already established the conversation scope. This capability is kept
   * separate from the user-facing service so transports cannot omit userId by
   * accident.
   */
  getRecordsByConversation(params: {
    conversationId: string;
    projectId: string;
  }): Promise<LangyMessageRecord[]>;
}

export class LangyMessageService {
  constructor(
    private readonly repository: LangyMessageRepository,
    private readonly conversations: LangyConversationRepository,
  ) {}

  static create(
    repository: LangyMessageRepository,
    conversations: LangyConversationRepository,
  ): LangyMessageService {
    return new LangyMessageService(repository, conversations);
  }

  static extractTextFromParts(parts: unknown): string {
    if (!Array.isArray(parts)) return "";
    return parts
      .map((part) =>
        part && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }

  static createTrustedMessageReader(
    repository: LangyMessageRepository,
  ): LangyTrustedMessageReader {
    return {
      async getRecordsByConversation(params): Promise<LangyMessageRecord[]> {
        const rows = await repository.findAllByConversation(params);
        return rows.map((row) => ({
          id: row.id,
          role: row.role,
          content: LangyMessageService.extractTextFromParts(row.parts),
        }));
      },
    };
  }

  async getAllByConversation(params: {
    conversationId: string;
    projectId: string;
    userId: string;
  }): Promise<LangyMessageRow[]> {
    const conversation = await this.conversations.tryFindVisibleById({
      id: params.conversationId,
      projectId: params.projectId,
      userId: params.userId,
    });
    if (!conversation) {
      // Missing and private-to-another-user deliberately share one result so
      // this read cannot become a cross-user conversation existence oracle.
      throw new LangyConversationNotFoundError(params.conversationId);
    }

    return await this.repository.findAllByConversation({
      conversationId: params.conversationId,
      projectId: params.projectId,
    });
  }
}
