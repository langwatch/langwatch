import type {
  Annotation,
  CreateAnnotationInput,
  DeleteAnnotationInput,
  ListAnnotationsInput,
  ProjectionAnnotation,
  UpdateAnnotationInput,
} from "./annotation";

export abstract class AnnotationService {
  abstract create(input: CreateAnnotationInput): Promise<Annotation>;
  abstract update(input: UpdateAnnotationInput): Promise<Annotation>;
  abstract delete(input: DeleteAnnotationInput): Promise<Annotation>;
  abstract getById(input: {
    id: string;
    projectId: string;
  }): Promise<Annotation>;
  abstract list(input: ListAnnotationsInput): Promise<Annotation[]>;
  abstract listForProjection(input: {
    projectId: string;
    traceIds: string[];
    anchor?: "trace" | "all";
  }): Promise<ProjectionAnnotation[]>;

  abstract getProjectOrganizationId(input: {
    projectId: string;
  }): Promise<string>;

  abstract assertQueueConfigurationReferences(input: {
    projectId: string;
    userIds: string[];
    scoreTypeIds: string[];
  }): Promise<void>;

  abstract assertAnnotatorReferences(input: {
    projectId: string;
    queueIds: string[];
    userIds: string[];
  }): Promise<void>;
}
