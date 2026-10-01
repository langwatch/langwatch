import type { AnnotationUsageCount } from "@langwatch/annotation-contract";
import { PrismaRepository } from "@langwatch/prisma-client";

import type { AnnotationUsageRepository } from "../annotation-usage.repository.ts";

/** Project-scoped reads; the caller never passes an empty project list. */
export class PrismaAnnotationUsageRepository
  extends PrismaRepository.for(
    "Annotation",
    "AnnotationQueue",
    "AnnotationQueueItem",
    "AnnotationScore",
  )
  implements AnnotationUsageRepository
{
  static readonly create = this.factory((prisma) => new PrismaAnnotationUsageRepository(prisma));

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<AnnotationUsageCount> {
    const scope = { projectId: { in: [...projectIds] } };
    const where = since === undefined ? scope : { ...scope, createdAt: { gte: new Date(since) } };
    const [annotations, annotationQueues, annotationQueueItems, annotationScores, first] =
      await Promise.all([
        this.prisma.annotation.count({ where }),
        this.prisma.annotationQueue.count({ where }),
        this.prisma.annotationQueueItem.count({ where }),
        this.prisma.annotationScore.count({ where }),
        this.prisma.annotation.findFirst({
          where: scope,
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
      ]);
    return {
      annotations,
      annotationQueues,
      annotationQueueItems,
      annotationScores,
      ...(first ? { firstAnnotationAt: first.createdAt.getTime() } : {}),
    };
  }
}
