import {
  AnnotationNotFoundError,
  annotationSchema,
  createAnnotationInputSchema,
  deleteAnnotationInputSchema,
  listAnnotationsInputSchema,
  listProjectionAnnotationsInputSchema,
  projectionAnnotationSchema,
  updateAnnotationInputSchema,
  type Annotation,
  type AnnotationByIdInput,
  type CreateAnnotationInput,
  type DeleteAnnotationInput,
  type ListAnnotationsInput,
  type ListProjectionAnnotationsInput,
  type ProjectionAnnotation,
  type UpdateAnnotationInput,
} from "@langwatch/annotation-contract";
import { PrismaRepository, type PrismaModelClient } from "@langwatch/prisma-client";
import type { Annotation as AnnotationRow, Prisma } from "@langwatch/prisma-client/generated";
import { isRecordNotFoundError } from "@langwatch/prisma-client/errors";
import type { AnnotationRepository } from "../annotation.repository.ts";

const annotationSelect = {
  id: true,
  projectId: true,
  traceId: true,
  comment: true,
  isThumbsUp: true,
  userId: true,
  email: true,
  scoreOptions: true,
  expectedOutput: true,
  anchorKind: true,
  anchorId: true,
  anchorPath: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The trace projections read only the columns the projection DSL exposes plus
 * the anchor. Selecting the whole row and handing it to the strict projection
 * schema is what made `listForProjection` throw on every call.
 */
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

function parseRow(row: AnnotationRow): Annotation {
  return annotationSchema.parse({
    ...row,
    scoreOptions: row.scoreOptions ?? {},
  });
}

function parseProjectionRow(
  row: Prisma.AnnotationGetPayload<{ select: typeof projectionAnnotationSelect }>,
): ProjectionAnnotation {
  return projectionAnnotationSchema.parse({
    ...row,
    scoreOptions: row.scoreOptions ?? {},
  });
}

export type AnnotationDatabase = PrismaModelClient<"Annotation">;

export class PrismaAnnotationRepository
  extends PrismaRepository.for("Annotation")
  implements AnnotationRepository
{
  static readonly create = this.factory((prisma) => new PrismaAnnotationRepository(prisma));

  async create(input: CreateAnnotationInput): Promise<Annotation> {
    const parsed = createAnnotationInputSchema.parse(input);

    const row = await this.prisma.annotation.create({
      data: {
        id: parsed.id,
        projectId: parsed.projectId,
        traceId: parsed.traceId,
        userId: parsed.userId,
        email: parsed.email,
        comment: parsed.comment,
        isThumbsUp: parsed.isThumbsUp,
        scoreOptions: parsed.scoreOptions,
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

    try {
      const row = await this.prisma.annotation.update({
        where: {
          id: parsed.id,
          projectId: parsed.projectId,
          ...(parsed.traceId === void 0 ? {} : { traceId: parsed.traceId }),
        },
        data: {
          comment: parsed.comment,
          isThumbsUp: parsed.isThumbsUp,
          ...(parsed.email === void 0 ? {} : { email: parsed.email }),
          ...(parsed.scoreOptions === void 0 ? {} : { scoreOptions: parsed.scoreOptions }),
          ...(parsed.expectedOutput === void 0 ? {} : { expectedOutput: parsed.expectedOutput }),
        },
        select: annotationSelect,
      });

      return parseRow(row);
    } catch (error) {
      if (isRecordNotFoundError(error)) throw new AnnotationNotFoundError(parsed.id);

      throw error;
    }
  }

  async delete(input: DeleteAnnotationInput): Promise<Annotation> {
    const parsed = deleteAnnotationInputSchema.parse(input);

    try {
      const row = await this.prisma.annotation.delete({
        where: { id: parsed.id, projectId: parsed.projectId },
        select: annotationSelect,
      });

      return parseRow(row);
    } catch (error) {
      if (isRecordNotFoundError(error)) throw new AnnotationNotFoundError(parsed.id);

      throw error;
    }
  }

  async getById(input: AnnotationByIdInput): Promise<Annotation> {
    const row = await this.prisma.annotation.findFirst({
      where: { id: input.id, projectId: input.projectId },
      select: annotationSelect,
    });

    if (!row) throw new AnnotationNotFoundError(input.id);

    return parseRow(row);
  }

  async list(input: ListAnnotationsInput): Promise<Annotation[]> {
    const parsed = listAnnotationsInputSchema.parse(input);

    const rows = await this.prisma.annotation.findMany({
      where: {
        projectId: parsed.projectId,
        ...(parsed.traceIds ? { traceId: { in: parsed.traceIds } } : {}),
        ...(parsed.anchor === "trace" ? { anchorKind: null } : {}),
        ...(parsed.startDate || parsed.endDate
          ? { createdAt: { gte: parsed.startDate, lte: parsed.endDate } }
          : {}),
      },
      ...(parsed.order === void 0 ? {} : { orderBy: { createdAt: parsed.order } }),
      select: annotationSelect,
    });

    return rows.map(parseRow);
  }

  async listForProjection(input: ListProjectionAnnotationsInput): Promise<ProjectionAnnotation[]> {
    const parsed = listProjectionAnnotationsInputSchema.parse(input);

    const rows = await this.prisma.annotation.findMany({
      where: {
        projectId: parsed.projectId,
        traceId: { in: parsed.traceIds },
        ...(parsed.anchor === "trace" ? { anchorKind: null } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: projectionAnnotationSelect,
    });

    return rows.map(parseProjectionRow);
  }
}
