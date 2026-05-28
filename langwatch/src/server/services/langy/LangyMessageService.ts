import type { LangyMessage, PrismaClient } from "@prisma/client";

export type MessageRole = "user" | "assistant" | "tool" | "system";

export type CreateMessageInput = {
  conversationId: string;
  projectId: string;
  role: MessageRole;
  parts: unknown;
  tokenCount?: number | null;
};

/**
 * Display shape the UI consumes when restoring a conversation. The raw
 * row stores `parts` (JSONB); the UI only renders text, so we flatten
 * the text parts into `content` here rather than leaking the JSONB blob.
 */
export type LangyMessageRecord = {
  id: string;
  role: MessageRole;
  content: string;
};

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) =>
      p && typeof (p as { text?: unknown }).text === "string"
        ? (p as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

export class LangyMessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAllByConversation({
    conversationId,
    projectId,
  }: {
    conversationId: string;
    projectId: string;
  }) {
    return await this.prisma.langyMessage.findMany({
      where: { conversationId, projectId },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(input: CreateMessageInput): Promise<LangyMessage> {
    return await this.prisma.langyMessage.create({
      data: {
        conversationId: input.conversationId,
        projectId: input.projectId,
        role: input.role,
        parts: input.parts as never,
        tokenCount: input.tokenCount ?? null,
      },
    });
  }

  async createMany(inputs: CreateMessageInput[]) {
    if (inputs.length === 0) return { count: 0 };
    return await this.prisma.langyMessage.createMany({
      data: inputs.map((i) => ({
        conversationId: i.conversationId,
        projectId: i.projectId,
        role: i.role,
        parts: i.parts as never,
        tokenCount: i.tokenCount ?? null,
      })),
    });
  }
}

export class LangyMessageService {
  constructor(private readonly repository: LangyMessageRepository) {}

  static create(prisma: PrismaClient): LangyMessageService {
    return new LangyMessageService(new LangyMessageRepository(prisma));
  }

  async getAllByConversation({
    conversationId,
    projectId,
  }: {
    conversationId: string;
    projectId: string;
  }): Promise<LangyMessage[]> {
    return await this.repository.findAllByConversation({
      conversationId,
      projectId,
    });
  }

  async getRecordsByConversation({
    conversationId,
    projectId,
  }: {
    conversationId: string;
    projectId: string;
  }): Promise<LangyMessageRecord[]> {
    const rows = await this.repository.findAllByConversation({
      conversationId,
      projectId,
    });
    return rows.map((r) => ({
      id: r.id,
      role: r.role as MessageRole,
      content: extractText(r.parts),
    }));
  }

  async append(input: CreateMessageInput): Promise<LangyMessage> {
    return await this.repository.create(input);
  }

  async appendMany(inputs: CreateMessageInput[]) {
    return await this.repository.createMany(inputs);
  }
}
