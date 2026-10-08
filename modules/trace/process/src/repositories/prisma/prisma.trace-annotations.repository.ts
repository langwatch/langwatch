import {
  type ProjectionAnnotation,
  projectionAnnotationSchema,
} from "@langwatch/annotation-contract";
import { PrismaRepository } from "@langwatch/prisma-client";

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

/** Annotation's `Annotation` rows, read through annotation's share (R40). */
export class PrismaTraceAnnotationsRepository
  extends PrismaRepository.for("Annotation")
  implements TraceAnnotationsReadRepository
{
  static readonly create = this.factory((prisma) => new PrismaTraceAnnotationsRepository(prisma));

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
