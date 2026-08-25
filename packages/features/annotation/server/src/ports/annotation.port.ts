import type {
  Annotation,
  CreateAnnotationInput,
  DeleteAnnotationInput,
  ListAnnotationsInput,
  ProjectionAnnotation,
  UpdateAnnotationInput,
} from "@langwatch/annotation-contract";

/** Private persistence capability for the Annotation service. */
export abstract class AnnotationRepository {
  abstract create(input: CreateAnnotationInput): Promise<Annotation>;
  abstract update(input: UpdateAnnotationInput): Promise<Annotation>;
  abstract delete(input: DeleteAnnotationInput): Promise<Annotation>;
  abstract tryFindById(input: {
    id: string;
    projectId: string;
  }): Promise<Annotation | null>;
  abstract list(input: ListAnnotationsInput): Promise<Annotation[]>;
  abstract listForProjection(input: {
    projectId: string;
    traceIds: string[];
    anchor: "trace" | "all";
  }): Promise<ProjectionAnnotation[]>;
}
