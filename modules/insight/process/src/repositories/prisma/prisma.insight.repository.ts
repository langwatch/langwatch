import { type InsightEntry, InsightNotFoundError } from "@langwatch/insight-contract";
import { PrismaRepository } from "@langwatch/prisma-client";

import type { InsightRepository } from "../insight.repository.ts";
import { insightEntryFromRows } from "./prisma.insight.mapper.ts";

/**
 * The inbox read: the project's insights, then that reader's rows for them, joined here
 * because both tables are this module's own. Every query carries `projectId`.
 */
export class PrismaInsightRepository
  extends PrismaRepository.for("InsightProjection", "InsightReaderProjection")
  implements InsightRepository
{
  static readonly create = this.factory((prisma) => new PrismaInsightRepository(prisma));

  async findForReader({
    projectId,
    userId,
    limit,
  }: {
    projectId: string;
    userId: string;
    limit: number;
  }): Promise<InsightEntry[]> {
    const insights = await this.prisma.insightProjection.findMany({
      where: { projectId },
      orderBy: { filedAt: "desc" },
      take: limit,
    });
    if (insights.length === 0) return [];
    const readers = await this.prisma.insightReaderProjection.findMany({
      where: { projectId, userId, insightId: { in: insights.map((insight) => insight.id) } },
    });
    const readerByInsight = new Map(readers.map((reader) => [reader.insightId, reader]));
    return insights.map((insight) =>
      insightEntryFromRows({ insight, reader: readerByInsight.get(insight.id) }),
    );
  }

  async getForReader({
    projectId,
    insightId,
    userId,
  }: {
    projectId: string;
    insightId: string;
    userId: string;
  }): Promise<InsightEntry> {
    const insight = await this.prisma.insightProjection.findFirst({
      where: { id: insightId, projectId },
    });
    if (!insight) throw new InsightNotFoundError(insightId);
    const reader = await this.prisma.insightReaderProjection.findFirst({
      where: { projectId, insightId, userId },
    });
    return insightEntryFromRows({ insight, reader: reader ?? undefined });
  }
}
