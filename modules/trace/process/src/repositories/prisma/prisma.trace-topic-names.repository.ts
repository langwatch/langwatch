import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { TraceTopicNamesReadRepository } from "../../features/topic/repositories/trace-topic-names.repository.ts";

/** Only the shared delegate this reader touches; it claims no table (R40). */
type PrismaTraceTopicNamesDatabase = Pick<PrismaClient, "topic">;

/** Topic's `Topic` rows, read through topic's share; topic's own name query. */
export class PrismaTraceTopicNamesRepository implements TraceTopicNamesReadRepository {
  private constructor(private readonly prisma: PrismaTraceTopicNamesDatabase) {}

  static create(prisma: PrismaTraceTopicNamesDatabase): PrismaTraceTopicNamesRepository {
    return new PrismaTraceTopicNamesRepository(prisma);
  }

  async findNamesByIds({
    projectId,
    ids,
  }: {
    projectId: string;
    ids: string[];
  }): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.topic.findMany({
      where: { projectId, id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
