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
import type { AnnotationFactsService } from "./annotation-facts.service.ts";

export class AnnotationScoreService {
  #repository: AnnotationScoreRepository;
  #facts: AnnotationFactsService;

  private constructor(repository: AnnotationScoreRepository, facts: AnnotationFactsService) {
    this.#repository = repository;
    this.#facts = facts;
  }

  static create(options: {
    repository: AnnotationScoreRepository;
    facts: AnnotationFactsService;
  }): AnnotationScoreService {
    return new AnnotationScoreService(options.repository, options.facts);
  }

  listScoreNames(input: ListAnnotationScoreNamesInput): Promise<AnnotationScoreName[]> {
    return this.#repository.findScoreNames(listAnnotationScoreNamesInputSchema.parse(input));
  }

  /** A first name is recorded as defined, a changed one as renamed; soft-deleted names count. */
  async upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore> {
    const parsed = upsertAnnotationScoreInputSchema.parse(input);
    const names = await this.#repository.findScoreNames({ projectId: parsed.projectId });
    const previous = names.find((score) => score.id === parsed.id);
    const score = await this.#repository.upsertScore(parsed);
    const fact = { scoreId: score.id, projectId: score.projectId, name: score.name };
    if (!previous) {
      await this.#facts.scoreDefined(fact);
    } else if (previous.name !== score.name) {
      await this.#facts.scoreRenamed({ ...fact, previousName: previous.name });
    }
    return score;
  }

  listScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]> {
    return this.#repository.findScores(listAnnotationScoresInputSchema.parse(input));
  }

  getScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
    return this.#repository.findScore(annotationScoreByIdInputSchema.parse(input));
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
