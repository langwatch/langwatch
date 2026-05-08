import type { LangyMessage, PrismaClient } from "@prisma/client";

export type MessageRole = "user" | "assistant" | "tool" | "system";

export type CreateMessageInput = {
  conversationId: string;
  projectId: string;
  role: MessageRole;
  parts: unknown;
  tokenCount?: number | null;
};

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

  async append(input: CreateMessageInput): Promise<LangyMessage> {
    return await this.repository.create(input);
  }

  async appendMany(inputs: CreateMessageInput[]) {
    return await this.repository.createMany(inputs);
  }
}
