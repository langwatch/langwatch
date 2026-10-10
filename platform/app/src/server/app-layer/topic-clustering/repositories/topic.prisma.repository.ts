import type { PrismaClient } from "~/generated/prisma/client";
import type { TopicRepository } from "./topic.repository";

export class PrismaTopicRepository implements TopicRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findNamesByIds({
    projectIds,
    ids,
  }: {
    projectIds: readonly string[];
    ids: readonly string[];
  }): Promise<Map<string, string>> {
    if (ids.length === 0 || projectIds.length === 0) return new Map();
    const rows = await this.prisma.topic.findMany({
      where: { projectId: { in: [...projectIds] }, id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async findAll(params: { projectId: string }) {
    return this.prisma.topic.findMany({
      where: { projectId: params.projectId },
      select: {
        id: true,
        name: true,
        parentId: true,
        automaticallyGenerated: true,
      },
    });
  }
}
