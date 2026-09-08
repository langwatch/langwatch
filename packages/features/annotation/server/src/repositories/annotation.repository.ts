import type {
  Annotation,
  AnnotationByIdInput,
  CreateAnnotationInput,
  DeleteAnnotationInput,
  ListAnnotationsInput,
  ListProjectionAnnotationsInput,
  ProjectionAnnotation,
  UpdateAnnotationInput,
} from "@langwatch/annotation-contract";

/** Private persistence capability for the Annotation service. */
export interface AnnotationRepository {
  create(input: CreateAnnotationInput): Promise<Annotation>;
  update(input: UpdateAnnotationInput): Promise<Annotation>;
  delete(input: DeleteAnnotationInput): Promise<Annotation>;
  getById(input: AnnotationByIdInput): Promise<Annotation>;
  list(input: ListAnnotationsInput): Promise<Annotation[]>;
  listForProjection(input: ListProjectionAnnotationsInput): Promise<ProjectionAnnotation[]>;
}
