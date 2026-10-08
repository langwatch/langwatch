import { PrismaRepository } from "@langwatch/prisma-client";

import type { TraceAnnotationScoresReadRepository } from "../trace-annotation-scores.repository.ts";

/** Annotation's `AnnotationScore` rows, read through annotation's share (R40). */
export class PrismaTraceAnnotationScoresRepository
  extends PrismaRepository.for("AnnotationScore")
  implements TraceAnnotationScoresReadRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaTraceAnnotationScoresRepository(prisma),
  );

  async findScoreNames({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    // No deletedAt filter: a soft-deleted definition still names the scores it gave.
    return this.prisma.annotationScore.findMany({
      where: { projectId },
      select: { id: true, name: true },
    });
  }
}
