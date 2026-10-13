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
import type { MemoryAnnotationQueueDatabase } from "./memory.annotation-queue.database.ts";

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

  async findScoreNames(input: ListAnnotationScoreNamesInput): Promise<AnnotationScoreName[]> {
    return this.#database
      .scores()
      .filter((score) => score.projectId === input.projectId)
      .map(({ id, name }) => annotationScoreNameSchema.parse({ id, name }));
  }

  async upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore> {
    let previous: AnnotationScore | undefined;
    try {
      previous = this.#database.getScore(input.projectId, input.id);
    } catch (error) {
      if (!(error instanceof AnnotationScoreNotFoundError)) throw error;
    }

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

  async findScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]> {
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

  async findScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    const score = this.#database.getScore(input.projectId, input.id);

    if (score.projectId !== input.projectId || score.deletedAt !== null) {
      throw new AnnotationScoreNotFoundError(input.id);
    }

    return structuredClone(score);
  }

  async toggleScore(input: ToggleAnnotationScoreInput): Promise<AnnotationScore> {
    const score = await this.findScore(input);

    const updated = annotationScoreSchema.parse({
      ...score,
      active: input.active,
      updatedAt: toDate(nowInstant()),
    });

    this.#database.replaceScore(updated);

    return structuredClone(updated);
  }

  async deleteScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    const score = await this.findScore(input);

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
    return this.#database
      .findScores(input.projectId, input.scoreTypeIds)
      .filter((score) => score.projectId === input.projectId).length;
  }
}
