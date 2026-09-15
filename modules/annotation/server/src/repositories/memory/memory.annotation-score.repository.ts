import {
  AnnotationScoreNotFoundError,
  annotationScoreNameSchema,
  annotationScoreSchema,
  type AnnotationScore,
  type AnnotationScoreByIdInput,
  type AnnotationScoreName,
  type ListAnnotationScoreNamesInput,
  type ListAnnotationScoresInput,
  type ToggleAnnotationScoreInput,
  type UpsertAnnotationScoreInput,
} from "@langwatch/annotation-contract";
import { nowInstant, toDate } from "@langwatch/time";
import type { AnnotationScoreRepository } from "../annotation-score.repository.ts";
import { MemoryAnnotationQueueDatabase } from "./memory.annotation-queue.database.ts";

export class MemoryAnnotationScoreRepository implements AnnotationScoreRepository {
  #database: MemoryAnnotationQueueDatabase;

  private constructor(database: MemoryAnnotationQueueDatabase) {
    this.#database = database;
  }

  static create(
    input: Readonly<{ memory: MemoryAnnotationQueueDatabase }>,
  ): MemoryAnnotationScoreRepository {
    return new MemoryAnnotationScoreRepository(input.memory);
  }

  async listScoreNames(input: ListAnnotationScoreNamesInput): Promise<AnnotationScoreName[]> {
    return this.#database
      .scores()
      .filter((score) => score.projectId === input.projectId)
      .map(({ id, name }) => annotationScoreNameSchema.parse({ id, name }));
  }

  async upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore> {
    const previous = this.#database.score(input.projectId, input.id);

    const score = annotationScoreSchema.parse({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      createdAt: previous?.createdAt ?? toDate(nowInstant()),
      updatedAt: toDate(nowInstant()),
      deletedAt: null,
      description: input.description,
      active: previous?.active ?? true,
      dataType: input.dataType,
      options: input.options,
      defaultValue: input.defaultValue,
      global: previous?.global ?? false,
    });

    this.#database.replaceScore(score);

    return structuredClone(score);
  }

  async listScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]> {
    const scores = this.#database
      .scores()
      .filter(
        (score) =>
          score.projectId === input.projectId &&
          score.deletedAt === null &&
          (input.activeOnly !== true || score.active),
      );

    if (input.activeOnly !== true) {
      scores.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    return scores.map((score) => structuredClone(score));
  }

  async getScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    const score = this.#database.score(input.projectId, input.id);

    if (!score || score.projectId !== input.projectId || score.deletedAt !== null) {
      throw new AnnotationScoreNotFoundError(input.id);
    }

    return structuredClone(score);
  }

  async toggleScore(input: ToggleAnnotationScoreInput): Promise<AnnotationScore> {
    const score = await this.getScore(input);

    const updated = annotationScoreSchema.parse({
      ...score,
      active: input.active,
      updatedAt: toDate(nowInstant()),
    });

    this.#database.replaceScore(updated);

    return structuredClone(updated);
  }

  async deleteScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    const score = await this.getScore(input);

    const updated = annotationScoreSchema.parse({
      ...score,
      deletedAt: toDate(nowInstant()),
      updatedAt: toDate(nowInstant()),
    });

    this.#database.replaceScore(updated);

    return structuredClone(updated);
  }

  async countAnnotationScores(input: {
    projectId: string;
    scoreTypeIds: string[];
  }): Promise<number> {
    return input.scoreTypeIds.filter((id) => {
      const score = this.#database.score(input.projectId, id);

      return score?.projectId === input.projectId;
    }).length;
  }
}
