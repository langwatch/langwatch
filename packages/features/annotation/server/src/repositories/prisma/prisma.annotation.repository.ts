import {
  annotationAnchorScopeWhere,
  annotationSchema,
  createAnnotationInputSchema,
  deleteAnnotationInputSchema,
  listAnnotationsInputSchema,
  projectionAnnotationSchema,
  updateAnnotationInputSchema,
  type Annotation,
  type CreateAnnotationInput,
  type DeleteAnnotationInput,
  type ListAnnotationsInput,
  type ProjectionAnnotation,
  type UpdateAnnotationInput,
} from "@langwatch/annotation-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { AnnotationRepository } from "../../ports/annotation.port";

type AnnotationRow = {
  id: string;
  projectId: string;
  traceId: string;
  comment: string | null;
  isThumbsUp: boolean | null;
  userId: string | null;
  scoreOptions: unknown;
  expectedOutput: string | null;
  anchorKind: string | null;
  anchorId: string | null;
  anchorPath: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const annotationSelect = {
  id: true,
  projectId: true,
  traceId: true,
  comment: true,
  isThumbsUp: true,
  userId: true,
  scoreOptions: true,
  expectedOutput: true,
  anchorKind: true,
  anchorId: true,
  anchorPath: true,
  createdAt: true,
  updatedAt: true,
} as const;

function parseRow(row: AnnotationRow): Annotation {
  return annotationSchema.parse({
    ...row,
    scoreOptions: row.scoreOptions ?? {},
  });
}

export class PrismaAnnotationRepository extends AnnotationRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: object): PrismaAnnotationRepository {
    return new PrismaAnnotationRepository(database as PrismaClient);
  }

  async create(input: CreateAnnotationInput): Promise<Annotation> {
    const parsed = createAnnotationInputSchema.parse(input);
    const row = await this.database.annotation.create({
      data: {
        id: parsed.id,
        projectId: parsed.projectId,
        traceId: parsed.traceId,
        userId: parsed.userId,
        comment: parsed.comment,
        isThumbsUp: parsed.isThumbsUp,
        scoreOptions: parsed.scoreOptions as Prisma.InputJsonValue,
        expectedOutput: parsed.expectedOutput,
        anchorKind: parsed.anchorKind ?? null,
        anchorId: parsed.anchorId ?? null,
        anchorPath: parsed.anchorPath ?? null,
      },
      select: annotationSelect,
    });
    return parseRow(row);
  }

  async update(input: UpdateAnnotationInput): Promise<Annotation> {
    const parsed = updateAnnotationInputSchema.parse(input);
    const row = await this.database.annotation.update({
      where: {
        id: parsed.id,
        projectId: parsed.projectId,
        traceId: parsed.traceId,
      },
      data: {
        comment: parsed.comment,
        isThumbsUp: parsed.isThumbsUp,
        scoreOptions: parsed.scoreOptions as Prisma.InputJsonValue,
        ...(parsed.expectedOutput === undefined
          ? {}
          : { expectedOutput: parsed.expectedOutput }),
      },
      select: annotationSelect,
    });
    return parseRow(row);
  }

  async delete(input: DeleteAnnotationInput): Promise<Annotation> {
    const parsed = deleteAnnotationInputSchema.parse(input);
    const row = await this.database.annotation.delete({
      where: { id: parsed.id, projectId: parsed.projectId },
      select: annotationSelect,
    });
    return parseRow(row);
  }

  async tryFindById(input: {
    id: string;
    projectId: string;
  }): Promise<Annotation | null> {
    const row = await this.database.annotation.findFirst({
      where: { id: input.id, projectId: input.projectId },
      select: annotationSelect,
    });
    return row ? parseRow(row) : null;
  }

  async list(input: ListAnnotationsInput): Promise<Annotation[]> {
    const parsed = listAnnotationsInputSchema.parse(input);
    const rows = await this.database.annotation.findMany({
      where: {
        projectId: parsed.projectId,
        ...(parsed.traceIds ? { traceId: { in: parsed.traceIds } } : {}),
        ...annotationAnchorScopeWhere(parsed.anchor),
      },
      orderBy: { createdAt: "desc" },
      select: annotationSelect,
    });
    return rows.map(parseRow);
  }

  async listForProjection(input: {
    projectId: string;
    traceIds: string[];
    anchor: "trace" | "all";
  }): Promise<ProjectionAnnotation[]> {
    const rows = await this.database.annotation.findMany({
      where: {
        projectId: input.projectId,
        traceId: { in: input.traceIds },
        ...annotationAnchorScopeWhere(input.anchor),
      },
      orderBy: { createdAt: "asc" },
      select: annotationSelect,
    });
    return rows.map((row) =>
      projectionAnnotationSchema.parse({
        ...parseRow(row),
      }),
    );
  }
}
