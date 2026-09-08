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
  listScoreNames(input: ListAnnotationScoreNamesInput): Promise<AnnotationScoreName[]>;
  upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore>;
  listScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]>;
  getScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore>;
  toggleScore(input: ToggleAnnotationScoreInput): Promise<AnnotationScore>;
  deleteScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore>;
  countAnnotationScores(input: { projectId: string; scoreTypeIds: string[] }): Promise<number>;
}
