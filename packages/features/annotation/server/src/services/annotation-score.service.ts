import {
  annotationScoreByIdInputSchema,
  listAnnotationScoreNamesInputSchema,
  listAnnotationScoresInputSchema,
  toggleAnnotationScoreInputSchema,
  upsertAnnotationScoreInputSchema,
  type AnnotationScore,
  type AnnotationScoreByIdInput,
  type AnnotationScoreName,
  type ListAnnotationScoreNamesInput,
  type ListAnnotationScoresInput,
  type ToggleAnnotationScoreInput,
  type UpsertAnnotationScoreInput,
} from "@langwatch/annotation-contract";
import type { AnnotationScoreRepository } from "../repositories/annotation-score.repository.ts";

export class AnnotationScoreService {
  #repository: AnnotationScoreRepository;

  private constructor(repository: AnnotationScoreRepository) {
    this.#repository = repository;
  }

  static create(options: { repository: AnnotationScoreRepository }): AnnotationScoreService {
    return new AnnotationScoreService(options.repository);
  }

  listScoreNames(input: ListAnnotationScoreNamesInput): Promise<AnnotationScoreName[]> {
    return this.#repository.listScoreNames(listAnnotationScoreNamesInputSchema.parse(input));
  }

  upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore> {
    return this.#repository.upsertScore(upsertAnnotationScoreInputSchema.parse(input));
  }

  listScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]> {
    return this.#repository.listScores(listAnnotationScoresInputSchema.parse(input));
  }

  getScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    return this.#repository.getScore(annotationScoreByIdInputSchema.parse(input));
  }

  toggleScore(input: ToggleAnnotationScoreInput): Promise<AnnotationScore> {
    return this.#repository.toggleScore(toggleAnnotationScoreInputSchema.parse(input));
  }

  deleteScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    return this.#repository.deleteScore(annotationScoreByIdInputSchema.parse(input));
  }

  countAnnotationScores(input: { projectId: string; scoreTypeIds: string[] }): Promise<number> {
    return this.#repository.countAnnotationScores(input);
  }
}
