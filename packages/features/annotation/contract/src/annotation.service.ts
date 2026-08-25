import type {
  Annotation,
  AnnotationByIdInput,
  AnnotationProjectInput,
  AnnotationScore,
  AnnotationScoreByIdInput,
  AnnotationScoreName,
  AssertAnnotatorReferencesInput,
  AssertQueueConfigurationReferencesInput,
  CreateAnnotationInput,
  CreateAnnotationQueueItemsInput,
  DeleteAnnotationInput,
  ListAnnotationScoreNamesInput,
  ListAnnotationScoresInput,
  ListAnnotationsInput,
  ListProjectionAnnotationsInput,
  ProjectionAnnotation,
  ToggleAnnotationScoreInput,
  UpdateAnnotationInput,
  UpsertAnnotationScoreInput,
} from "./annotation";

export abstract class AnnotationService {
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
  abstract getProjectOrganizationId(input: AnnotationProjectInput): Promise<string>;
  abstract assertQueueConfigurationReferences(
    input: AssertQueueConfigurationReferencesInput,
  ): Promise<void>;
  abstract assertAnnotatorReferences(
    input: AssertAnnotatorReferencesInput,
  ): Promise<void>;
}
