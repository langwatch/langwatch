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
  abstract findProjectOrganizationId(input: {
    projectId: string;
  }): Promise<string | null>;
  abstract countOrganizationUsers(input: {
    organizationId: string;
    userIds: string[];
  }): Promise<number>;
  abstract countAnnotationScores(input: {
    projectId: string;
    scoreTypeIds: string[];
  }): Promise<number>;
  abstract countAnnotationQueues(input: {
    projectId: string;
    queueIds: string[];
  }): Promise<number>;
}
