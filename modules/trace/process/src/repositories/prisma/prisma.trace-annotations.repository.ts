import {
  type ProjectionAnnotation,
  projectionAnnotationSchema,
} from "@langwatch/annotation-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { TraceAnnotationsReadRepository } from "../trace-annotations.repository.ts";

/** Only the columns the projection exposes plus the anchor, as annotation's own read selects. */
const projectionAnnotationSelect = {
  id: true,
  traceId: true,
  isThumbsUp: true,
  comment: true,
  expectedOutput: true,
  scoreOptions: true,
  createdAt: true,
  anchorKind: true,
  anchorId: true,
  anchorPath: true,
} as const;

/** Only the shared delegate this reader touches; it claims no table (R40). */
type PrismaTraceAnnotationsDatabase = Pick<PrismaClient, "annotation">;

/** Annotation's `Annotation` rows, read through annotation's share. */
export class PrismaTraceAnnotationsRepository implements TraceAnnotationsReadRepository {
  private constructor(private readonly prisma: PrismaTraceAnnotationsDatabase) {}

  static create(prisma: PrismaTraceAnnotationsDatabase): PrismaTraceAnnotationsRepository {
    return new PrismaTraceAnnotationsRepository(prisma);
  }

  async findForTraces({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<ProjectionAnnotation[]> {
    const rows = await this.prisma.annotation.findMany({
      where: { projectId, traceId: { in: traceIds } },
      orderBy: { createdAt: "asc" },
      select: projectionAnnotationSelect,
    });
    return rows.map((row) =>
      projectionAnnotationSchema.parse({ ...row, scoreOptions: row.scoreOptions ?? {} }),
    );
  }
}
