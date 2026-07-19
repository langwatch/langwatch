import type {
  LangyMessageRepository,
  LangyMessageRow,
} from "./repositories/langy-message.repository";
import type { LangyConversationRepository } from "./repositories/langy-conversation.repository";
import { LangyConversationNotFoundError } from "./errors";

export type {
  LangyMessageRepository,
  LangyMessageRow,
} from "./repositories/langy-message.repository";
export type { MessageRole } from "./repositories/langy-message.repository";

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

export function extractTextFromParts(parts: unknown): string {
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

export class LangyMessageService {
  constructor(
    private readonly repository: LangyMessageRepository,
    private readonly conversations: LangyConversationRepository,
  ) {}

  async getAllByConversation(params: {
    conversationId: string;
    projectId: string;
    userId: string;
  }): Promise<LangyMessageRow[]> {
    const conversation = await this.conversations.findVisibleById({
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

/**
 * Build the narrow transcript capability used by trusted background work such
 * as title generation. It is intentionally not exposed on LangyMessageService
 * or AppDependencies, where user-facing transports could call it.
 */
export function createLangyTrustedMessageReader(
  repository: LangyMessageRepository,
): LangyTrustedMessageReader {
  return {
    async getRecordsByConversation(params): Promise<LangyMessageRecord[]> {
      const rows = await repository.findAllByConversation(params);
      return rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: extractTextFromParts(row.parts),
      }));
    },
  };
}
