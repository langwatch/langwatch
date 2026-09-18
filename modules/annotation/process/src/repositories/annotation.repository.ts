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
  findById(input: AnnotationByIdInput): Promise<Annotation>;
  findAll(input: ListAnnotationsInput): Promise<Annotation[]>;
  findForProjection(input: ListProjectionAnnotationsInput): Promise<ProjectionAnnotation[]>;
}
