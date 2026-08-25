import { langyMessagePartSchema } from "@langwatch/langy-contract";
import type { LangyDatabase } from "./langy-database.port";
import { LangyMessageRepository } from "../langy-message.repository";
import type { LangyMessageRow, MessageRole } from "../langy-message.repository";

export class PrismaLangyMessageRepository extends LangyMessageRepository {
  constructor(private readonly prisma: LangyDatabase) {
    super();
  }

  static create(database: LangyDatabase): PrismaLangyMessageRepository {
    return new PrismaLangyMessageRepository(database);
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
    return rows.map(
      (row: { MessageId: string; Role: string; Parts: unknown; CreatedAt: number }) => ({
        id: row.MessageId,
        role: row.Role as MessageRole,
        parts: langyMessagePartSchema.array().parse(row.Parts),
        createdAt: new Date(row.CreatedAt),
      }),
    );
  }
}
