import {
  AnnotationNotFoundError,
  annotationSchema,
  projectionAnnotationSchema,
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
import { isRecordNotFoundError } from "@langwatch/prisma-client/errors";
import type { Annotation as AnnotationRow, Prisma } from "@langwatch/prisma-client/generated";

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
    const row = await this.prisma.annotation.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        traceId: input.traceId,
        userId: input.userId,
        email: input.email,
        comment: input.comment,
        isThumbsUp: input.isThumbsUp,
        scoreOptions: input.scoreOptions,
        expectedOutput: input.expectedOutput,
        anchorKind: input.anchorKind ?? null,
        anchorId: input.anchorId ?? null,
        anchorPath: input.anchorPath ?? null,
      },
      select: annotationSelect,
    });

    return parseRow(row);
  }

  async update(input: UpdateAnnotationInput): Promise<Annotation> {
    try {
      const row = await this.prisma.annotation.update({
        where: {
          id: input.id,
          projectId: input.projectId,
          ...(input.traceId === void 0 ? {} : { traceId: input.traceId }),
        },
        data: {
          comment: input.comment,
          isThumbsUp: input.isThumbsUp,
          ...(input.email === void 0 ? {} : { email: input.email }),
          ...(input.scoreOptions === void 0 ? {} : { scoreOptions: input.scoreOptions }),
          ...(input.expectedOutput === void 0 ? {} : { expectedOutput: input.expectedOutput }),
        },
        select: annotationSelect,
      });

      return parseRow(row);
    } catch (error) {
      if (isRecordNotFoundError(error)) throw new AnnotationNotFoundError(input.id);

      throw error;
    }
  }

  async delete(input: DeleteAnnotationInput): Promise<Annotation> {
    try {
      const row = await this.prisma.annotation.delete({
        where: { id: input.id, projectId: input.projectId },
        select: annotationSelect,
      });

      return parseRow(row);
    } catch (error) {
      if (isRecordNotFoundError(error)) throw new AnnotationNotFoundError(input.id);

      throw error;
    }
  }

  async findById(input: AnnotationByIdInput): Promise<Annotation> {
    const row = await this.prisma.annotation.findFirst({
      where: { id: input.id, projectId: input.projectId },
      select: annotationSelect,
    });

    if (!row) throw new AnnotationNotFoundError(input.id);

    return parseRow(row);
  }

  async findAll(input: ListAnnotationsInput): Promise<Annotation[]> {
    const rows = await this.prisma.annotation.findMany({
      where: {
        projectId: input.projectId,
        ...(input.traceIds ? { traceId: { in: input.traceIds } } : {}),
        ...(input.anchor === "trace" ? { anchorKind: null } : {}),
        ...(input.startDate || input.endDate
          ? { createdAt: { gte: input.startDate, lte: input.endDate } }
          : {}),
      },
      ...(input.order === void 0 ? {} : { orderBy: { createdAt: input.order } }),
      select: annotationSelect,
    });

    return rows.map(parseRow);
  }

  async findForProjection(input: ListProjectionAnnotationsInput): Promise<ProjectionAnnotation[]> {
    const rows = await this.prisma.annotation.findMany({
      where: {
        projectId: input.projectId,
        traceId: { in: input.traceIds },
        ...(input.anchor === "trace" ? { anchorKind: null } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: projectionAnnotationSelect,
    });

    return rows.map(parseProjectionRow);
  }
}
