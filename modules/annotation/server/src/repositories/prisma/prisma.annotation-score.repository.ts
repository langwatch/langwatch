import {
  AnnotationScoreNotFoundError,
  annotationScoreSchema,
  type AnnotationScore,
  type AnnotationScoreByIdInput,
  type AnnotationScoreName,
  type ListAnnotationScoreNamesInput,
  type ListAnnotationScoresInput,
  type ToggleAnnotationScoreInput,
  type UpsertAnnotationScoreInput,
} from "@langwatch/annotation-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { isRecordNotFoundError } from "@langwatch/prisma-client/errors";
import type { AnnotationScoreRepository } from "../annotation-score.repository.ts";

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

export class PrismaAnnotationScoreRepository
  extends PrismaRepository.for("AnnotationScore")
  implements AnnotationScoreRepository
{
  static readonly create = this.factory((prisma) => new PrismaAnnotationScoreRepository(prisma));

  async listScoreNames(input: ListAnnotationScoreNamesInput): Promise<AnnotationScoreName[]> {
    const rows = await this.prisma.annotationScore.findMany({
      where: { projectId: input.projectId },
      select: { id: true, name: true },
    });

    return rows;
  }

  async upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore> {
    const data = {
      projectId: input.projectId,
      name: input.name,
      dataType: input.dataType,
      description: input.description,
      options: input.options,
      defaultValue: input.defaultValue,
      deletedAt: null,
    };

    const row = await this.prisma.annotationScore.upsert({
      where: { id: input.id, projectId: input.projectId },
      update: data,
      create: { ...data, id: input.id },
      select: annotationScoreSelect,
    });

    return annotationScoreSchema.parse(row);
  }

  async listScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]> {
    const rows = await this.prisma.annotationScore.findMany({
      where: {
        projectId: input.projectId,
        deletedAt: null,
        ...(input.activeOnly === true ? { active: true } : {}),
      },
      ...(input.activeOnly === true ? {} : { orderBy: { createdAt: "desc" as const } }),
      select: annotationScoreSelect,
    });

    return rows.map((row) => annotationScoreSchema.parse(row));
  }

  async getScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    const row = await this.prisma.annotationScore.findFirst({
      where: { id: input.id, projectId: input.projectId, deletedAt: null },
      select: annotationScoreSelect,
    });

    if (!row) throw new AnnotationScoreNotFoundError(input.id);

    return annotationScoreSchema.parse(row);
  }

  async toggleScore(input: ToggleAnnotationScoreInput): Promise<AnnotationScore> {
    try {
      const row = await this.prisma.annotationScore.update({
        where: { id: input.id, projectId: input.projectId },
        data: { active: input.active },
        select: annotationScoreSelect,
      });

      return annotationScoreSchema.parse(row);
    } catch (error) {
      if (isRecordNotFoundError(error)) throw new AnnotationScoreNotFoundError(input.id);

      throw error;
    }
  }

  async deleteScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    try {
      const row = await this.prisma.annotationScore.update({
        where: { id: input.id, projectId: input.projectId },
        data: { deletedAt: new Date() },
        select: annotationScoreSelect,
      });

      return annotationScoreSchema.parse(row);
    } catch (error) {
      if (isRecordNotFoundError(error)) throw new AnnotationScoreNotFoundError(input.id);

      throw error;
    }
  }

  countAnnotationScores(input: { projectId: string; scoreTypeIds: string[] }): Promise<number> {
    if (input.scoreTypeIds.length === 0) return Promise.resolve(0);

    return this.prisma.annotationScore.count({
      where: { projectId: input.projectId, id: { in: input.scoreTypeIds } },
    });
  }
}
