import { langyMessagePartSchema } from "@langwatch/langy-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { LangyMessageRepository } from "../langy-message.repository";
import type {
  LangyMessageRow,
  MessageRole,
} from "../langy-message.repository";

export class PrismaLangyMessageRepository extends LangyMessageRepository {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(database: object): PrismaLangyMessageRepository {
    return new PrismaLangyMessageRepository(database as PrismaClient);
  }

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
