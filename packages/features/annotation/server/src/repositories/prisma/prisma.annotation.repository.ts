import {
  AnnotationNotFoundError,
  AnnotationScoreNotFoundError,
  annotationScoreNameSchema,
  annotationScoreSchema,
  annotationSchema,
  createAnnotationQueueItemsInputSchema,
  createAnnotationInputSchema,
  deleteAnnotationInputSchema,
  listAnnotationsInputSchema,
  listProjectionAnnotationsInputSchema,
  projectionAnnotationSchema,
  updateAnnotationInputSchema,
  type Annotation,
  type AnnotationByIdInput,
  type AnnotationScore,
  type AnnotationScoreByIdInput,
  type AnnotationScoreName,
  type CreateAnnotationInput,
  type CreateAnnotationQueueItemsInput,
  type DeleteAnnotationInput,
  type ListAnnotationScoreNamesInput,
  type ListAnnotationScoresInput,
  type ListAnnotationsInput,
  type ListProjectionAnnotationsInput,
  type ProjectionAnnotation,
  type ToggleAnnotationScoreInput,
  type UpdateAnnotationInput,
  type UpsertAnnotationScoreInput,
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
  email: string | null;
  scoreOptions: unknown;
  expectedOutput: string | null;
  anchorKind: string | null;
  anchorId: string | null;
  anchorPath: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type AnnotationScoreRow = {
  id: string;
  projectId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  description: string | null;
  active: boolean;
  dataType: string | null;
  options: unknown;
  defaultValue: unknown;
  global: boolean;
};

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

const annotationScoreSelect = {
  id: true,
  projectId: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  description: true,
  active: true,
  dataType: true,
  options: true,
  defaultValue: true,
  global: true,
} as const;

function parseRow(row: AnnotationRow): Annotation {
  return annotationSchema.parse({
    ...row,
    scoreOptions: row.scoreOptions ?? {},
  });
}

function parseScore(row: AnnotationScoreRow): AnnotationScore {
  return annotationScoreSchema.parse(row);
}

function anchorScopeWhere(scope: "trace" | "all") {
  return scope === "trace" ? { anchorKind: null } : {};
}

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

export class PrismaAnnotationRepository extends AnnotationRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: PrismaClient): PrismaAnnotationRepository {
    return new PrismaAnnotationRepository(database);
  }

  async create(input: CreateAnnotationInput): Promise<Annotation> {
    const parsed = createAnnotationInputSchema.parse(input);
    const row = await this.database.annotation.create({
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
      const row = await this.database.annotation.update({
        where: {
          id: parsed.id,
          projectId: parsed.projectId,
          ...(parsed.traceId === void 0 ? {} : { traceId: parsed.traceId }),
        },
        data: {
          comment: parsed.comment,
          isThumbsUp: parsed.isThumbsUp,
          ...(parsed.email === void 0 ? {} : { email: parsed.email }),
          ...(parsed.scoreOptions === void 0
            ? {}
            : { scoreOptions: parsed.scoreOptions }),
          ...(parsed.expectedOutput === void 0
            ? {}
            : { expectedOutput: parsed.expectedOutput }),
        },
        select: annotationSelect,
      });
      return parseRow(row);
    } catch (error) {
      if (isRecordNotFound(error)) throw new AnnotationNotFoundError(parsed.id);
      throw error;
    }
  }

  async delete(input: DeleteAnnotationInput): Promise<Annotation> {
    const parsed = deleteAnnotationInputSchema.parse(input);
    try {
      const row = await this.database.annotation.delete({
        where: { id: parsed.id, projectId: parsed.projectId },
        select: annotationSelect,
      });
      return parseRow(row);
    } catch (error) {
      if (isRecordNotFound(error)) throw new AnnotationNotFoundError(parsed.id);
      throw error;
    }
  }

  async getById(input: AnnotationByIdInput): Promise<Annotation> {
    const row = await this.database.annotation.findFirst({
      where: { id: input.id, projectId: input.projectId },
      select: annotationSelect,
    });
    if (!row) throw new AnnotationNotFoundError(input.id);
    return parseRow(row);
  }

  async list(input: ListAnnotationsInput): Promise<Annotation[]> {
    const parsed = listAnnotationsInputSchema.parse(input);
    const rows = await this.database.annotation.findMany({
      where: {
        projectId: parsed.projectId,
        ...(parsed.traceIds ? { traceId: { in: parsed.traceIds } } : {}),
        ...anchorScopeWhere(parsed.anchor),
        ...(parsed.startDate || parsed.endDate
          ? { createdAt: { gte: parsed.startDate, lte: parsed.endDate } }
          : {}),
      },
      ...(parsed.order === void 0 ? {} : { orderBy: { createdAt: parsed.order } }),
      select: annotationSelect,
    });
    return rows.map(parseRow);
  }

  async listForProjection(
    input: ListProjectionAnnotationsInput,
  ): Promise<ProjectionAnnotation[]> {
    const parsed = listProjectionAnnotationsInputSchema.parse(input);
    const rows = await this.database.annotation.findMany({
      where: {
        projectId: parsed.projectId,
        traceId: { in: parsed.traceIds },
        ...anchorScopeWhere(parsed.anchor),
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

  async listScoreNames(
    input: ListAnnotationScoreNamesInput,
  ): Promise<AnnotationScoreName[]> {
    const rows = await this.database.annotationScore.findMany({
      where: { projectId: input.projectId },
      select: { id: true, name: true },
    });
    return rows.map((row) => annotationScoreNameSchema.parse(row));
  }

  async upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore> {
    const row = await this.database.annotationScore.upsert({
      where: { id: input.id, projectId: input.projectId },
      update: {
        projectId: input.projectId,
        name: input.name,
        dataType: input.dataType,
        description: input.description,
        options: input.options,
        defaultValue: input.defaultValue,
        deletedAt: null,
      },
      create: {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        dataType: input.dataType,
        description: input.description,
        options: input.options,
        defaultValue: input.defaultValue,
        deletedAt: null,
      },
      select: annotationScoreSelect,
    });
    return parseScore(row);
  }

  async listScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]> {
    const rows = await this.database.annotationScore.findMany({
      where: {
        projectId: input.projectId,
        deletedAt: null,
        ...(input.activeOnly === true ? { active: true } : {}),
      },
      ...(input.activeOnly === true ? {} : { orderBy: { createdAt: "desc" as const } }),
      select: annotationScoreSelect,
    });
    return rows.map(parseScore);
  }

  async getScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    const row = await this.database.annotationScore.findFirst({
      where: { id: input.id, projectId: input.projectId, deletedAt: null },
      select: annotationScoreSelect,
    });
    if (!row) throw new AnnotationScoreNotFoundError(input.id);
    return parseScore(row);
  }

  async toggleScore(input: ToggleAnnotationScoreInput): Promise<AnnotationScore> {
    try {
      const row = await this.database.annotationScore.update({
        where: { id: input.id, projectId: input.projectId },
        data: { active: input.active },
        select: annotationScoreSelect,
      });
      return parseScore(row);
    } catch (error) {
      if (isRecordNotFound(error)) throw new AnnotationScoreNotFoundError(input.id);
      throw error;
    }
  }

  async deleteScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    try {
      const row = await this.database.annotationScore.update({
        where: { id: input.id, projectId: input.projectId },
        data: { deletedAt: new Date() },
        select: annotationScoreSelect,
      });
      return parseScore(row);
    } catch (error) {
      if (isRecordNotFound(error)) throw new AnnotationScoreNotFoundError(input.id);
      throw error;
    }
  }

  async createQueueItems(input: CreateAnnotationQueueItemsInput): Promise<void> {
    const parsed = createAnnotationQueueItemsInputSchema.parse(input);
    const queueItems = parsed.traceIds.flatMap((traceId) =>
      parsed.queueIds.map((annotationQueueId) => ({
        annotationQueueId,
        traceId,
        projectId: parsed.projectId,
        createdByUserId: parsed.createdByUserId,
      })),
    );
    const userItems = parsed.traceIds.flatMap((traceId) =>
      parsed.userIds.map((userId) => ({
        userId,
        traceId,
        projectId: parsed.projectId,
        createdByUserId: parsed.createdByUserId,
      })),
    );

    await this.database.$transaction(async (transaction) => {
      if (queueItems.length > 0) {
        await transaction.annotationQueueItem.createMany({
          data: queueItems,
          skipDuplicates: true,
        });
        await transaction.annotationQueueItem.updateMany({
          where: {
            projectId: parsed.projectId,
            traceId: { in: parsed.traceIds },
            annotationQueueId: { in: parsed.queueIds },
          },
          data: { doneAt: null },
        });
      }
      if (userItems.length > 0) {
        await transaction.annotationQueueItem.createMany({
          data: userItems,
          skipDuplicates: true,
        });
        await transaction.annotationQueueItem.updateMany({
          where: {
            projectId: parsed.projectId,
            traceId: { in: parsed.traceIds },
            userId: { in: parsed.userIds },
          },
          data: { doneAt: null },
        });
      }
    });
  }

  async countAnnotationScores(input: {
    projectId: string;
    scoreTypeIds: string[];
  }): Promise<number> {
    if (input.scoreTypeIds.length === 0) return 0;
    return this.database.annotationScore.count({
      where: { projectId: input.projectId, id: { in: input.scoreTypeIds } },
    });
  }

  async countAnnotationQueues(input: {
    projectId: string;
    queueIds: string[];
  }): Promise<number> {
    if (input.queueIds.length === 0) return 0;
    return this.database.annotationQueue.count({
      where: { projectId: input.projectId, id: { in: input.queueIds } },
    });
  }
}
