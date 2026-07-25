import type { PrismaClient } from "@prisma/client";

import { langyMessagePartSchema } from "@langwatch/langy";
import type {
  LangyMessageRepository,
  LangyMessageRow,
  MessageRole,
} from "./langy-message.repository";

export class PrismaLangyMessageRepository implements LangyMessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAllByConversation({
    conversationId: ConversationId,
    projectId,
  }: {
    conversationId: string;
    projectId: string;
  }): Promise<LangyMessageRow[]> {
    const rows = await this.prisma.langyMessageProjection.findMany({
      where: { projectId, ConversationId },
      orderBy: [{ CreatedAt: "asc" }, { MessageId: "asc" }],
    });
    return rows.map((row) => ({
      id: row.MessageId,
      role: row.Role as MessageRole,
      parts: langyMessagePartSchema.array().parse(row.Parts),
      createdAt: new Date(row.CreatedAt),
    }));
  }
}
