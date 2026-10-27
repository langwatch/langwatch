import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { TraceAnnotationScoresReadRepository } from "../trace-annotation-scores.repository.ts";

/** Only the shared delegate this reader touches; it claims no table (R40). */
type PrismaTraceAnnotationScoresDatabase = Pick<PrismaClient, "annotationScore">;

/** Annotation's `AnnotationScore` rows, read through annotation's share. */
export class PrismaTraceAnnotationScoresRepository implements TraceAnnotationScoresReadRepository {
  private constructor(private readonly prisma: PrismaTraceAnnotationScoresDatabase) {}

  static create(
    prisma: PrismaTraceAnnotationScoresDatabase,
  ): PrismaTraceAnnotationScoresRepository {
    return new PrismaTraceAnnotationScoresRepository(prisma);
  }

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
