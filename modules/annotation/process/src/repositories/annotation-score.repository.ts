import type {
  AnnotationScore,
  AnnotationScoreByIdInput,
  AnnotationScoreName,
  ListAnnotationScoreNamesInput,
  ListAnnotationScoresInput,
  ToggleAnnotationScoreInput,
  UpsertAnnotationScoreInput,
} from "@langwatch/annotation-contract";

export interface AnnotationScoreRepository {
  findScoreNames(input: ListAnnotationScoreNamesInput): Promise<AnnotationScoreName[]>;
  upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore>;
  findScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]>;
  findScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore>;
  toggleScore(input: ToggleAnnotationScoreInput): Promise<AnnotationScore>;
  deleteScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore>;
  countAnnotationScores(input: { projectId: string; scoreTypeIds: string[] }): Promise<number>;
}
