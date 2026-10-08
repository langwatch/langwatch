import { PrismaRepository } from "@langwatch/prisma-client";

import type { TraceTopicNamesReadRepository } from "../trace-topic-names.repository.ts";

/** Topic's `Topic` rows, read through topic's share (R40); topic's own name query. */
export class PrismaTraceTopicNamesRepository
  extends PrismaRepository.for("Topic")
  implements TraceTopicNamesReadRepository
{
  static readonly create = this.factory((prisma) => new PrismaTraceTopicNamesRepository(prisma));

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
