import type { PrismaClient } from "@prisma/client";
import type { TopicRepository } from "./topic.repository";

export class PrismaTopicRepository implements TopicRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findNamesByIds(
    projectId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.topic.findMany({
      where: { projectId, id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
