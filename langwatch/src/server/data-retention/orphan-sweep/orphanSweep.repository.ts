import type { PrismaClient } from "@prisma/client";

export interface OrphanCleanupResult {
  model: string;
  count: number;
}

export class OrphanSweepRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findCandidateTraceIds({
    projectId,
    limit = 1000,
  }: {
    projectId: string;
    limit?: number;
  }): Promise<string[]> {
    const [annotations, queueItems, publicShares, triggerSents, pinnedTraces] =
      await Promise.all([
        this.prisma.annotation.findMany({
          where: { projectId },
          select: { traceId: true },
          take: limit,
        }),
        this.prisma.annotationQueueItem.findMany({
          where: { projectId },
          select: { traceId: true },
          take: limit,
        }),
        this.prisma.publicShare.findMany({
          where: { projectId, resourceType: "TRACE" },
          select: { resourceId: true },
          take: limit,
        }),
        this.prisma.triggerSent.findMany({
          where: { projectId, traceId: { not: null } },
          select: { traceId: true },
          take: limit,
        }),
        this.prisma.pinnedTrace.findMany({
          where: { projectId },
          select: { traceId: true },
          take: limit,
        }),
      ]);

    const traceIds = new Set<string>();
    for (const row of annotations) traceIds.add(row.traceId);
    for (const row of queueItems) traceIds.add(row.traceId);
    for (const row of publicShares) traceIds.add(row.resourceId);
    for (const row of triggerSents) {
      if (row.traceId) traceIds.add(row.traceId);
    }
    for (const row of pinnedTraces) traceIds.add(row.traceId);

    return [...traceIds].slice(0, limit);
  }

  async deleteAnnotations({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<number> {
    const result = await this.prisma.annotation.deleteMany({
      where: { projectId, traceId: { in: traceIds } },
    });
    return result.count;
  }

  async deleteAnnotationQueueItems({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<number> {
    const result = await this.prisma.annotationQueueItem.deleteMany({
      where: { projectId, traceId: { in: traceIds } },
    });
    return result.count;
  }

  async deletePublicShares({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<number> {
    const result = await this.prisma.publicShare.deleteMany({
      where: {
        projectId,
        resourceType: "TRACE",
        resourceId: { in: traceIds },
      },
    });
    return result.count;
  }

  async nullifyTriggerSentTraceIds({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<number> {
    const result = await this.prisma.triggerSent.updateMany({
      where: { projectId, traceId: { in: traceIds } },
      data: { traceId: null },
    });
    return result.count;
  }

  async deletePinnedTraces({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<number> {
    const result = await this.prisma.pinnedTrace.deleteMany({
      where: { projectId, traceId: { in: traceIds } },
    });
    return result.count;
  }
}
