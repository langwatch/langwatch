import type {
  Annotation,
  AnnotationByIdInput,
  CreateAnnotationInput,
  DeleteAnnotationInput,
  ListAnnotationsInput,
  ListAnnotationScoreNamesInput,
  ListAnnotationScoresInput,
  ListProjectionAnnotationsInput,
  ProjectionAnnotation,
  AnnotationScore,
  AnnotationScoreByIdInput,
  AnnotationScoreName,
  ToggleAnnotationScoreInput,
  UpdateAnnotationInput,
  UpsertAnnotationScoreInput,
  CreateAnnotationQueueItemsInput,
} from "@langwatch/annotation-contract";

/** Private persistence capability for the Annotation service. */
export abstract class AnnotationRepository {
  abstract create(input: CreateAnnotationInput): Promise<Annotation>;
  abstract update(input: UpdateAnnotationInput): Promise<Annotation>;
  abstract delete(input: DeleteAnnotationInput): Promise<Annotation>;
  abstract getById(input: AnnotationByIdInput): Promise<Annotation>;
  abstract list(input: ListAnnotationsInput): Promise<Annotation[]>;
  abstract listForProjection(
    input: ListProjectionAnnotationsInput,
  ): Promise<ProjectionAnnotation[]>;
  abstract listScoreNames(
    input: ListAnnotationScoreNamesInput,
  ): Promise<AnnotationScoreName[]>;
  abstract upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore>;
  abstract listScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]>;
  abstract getScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore>;
  abstract toggleScore(input: ToggleAnnotationScoreInput): Promise<AnnotationScore>;
  abstract deleteScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore>;
  abstract createQueueItems(input: CreateAnnotationQueueItemsInput): Promise<void>;
  abstract countAnnotationScores(input: {
    projectId: string;
    scoreTypeIds: string[];
  }): Promise<number>;
  abstract countAnnotationQueues(input: {
    projectId: string;
    queueIds: string[];
  }): Promise<number>;
}
