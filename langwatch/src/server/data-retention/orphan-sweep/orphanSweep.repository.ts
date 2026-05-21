import type { PrismaClient } from "@prisma/client";

export interface OrphanCleanupResult {
  model: string;
  count: number;
}

export class OrphanSweepRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
