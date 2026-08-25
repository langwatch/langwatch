import {
  AnnotationNotFoundError,
  AnnotationService as AnnotationServiceContract,
  createAnnotationInputSchema,
  deleteAnnotationInputSchema,
  listAnnotationsInputSchema,
  updateAnnotationInputSchema,
  type Annotation,
  type CreateAnnotationInput,
  type DeleteAnnotationInput,
  type ListAnnotationsInput,
  type ProjectionAnnotation,
  type UpdateAnnotationInput,
} from "@langwatch/annotation-contract";
import { AnnotationRepository } from "../ports/annotation.port";

export class AnnotationService extends AnnotationServiceContract {
  private constructor(private readonly repository: AnnotationRepository) {
    super();
  }

  static create(options: { repository: AnnotationRepository }): AnnotationService {
    return new AnnotationService(options.repository);
  }

  create(input: CreateAnnotationInput): Promise<Annotation> {
    return this.repository.create(createAnnotationInputSchema.parse(input));
  }

  update(input: UpdateAnnotationInput): Promise<Annotation> {
    return this.repository.update(updateAnnotationInputSchema.parse(input));
  }

  delete(input: DeleteAnnotationInput): Promise<Annotation> {
    return this.repository.delete(deleteAnnotationInputSchema.parse(input));
  }

  async getById(input: { id: string; projectId: string }): Promise<Annotation> {
    const annotation = await this.repository.tryFindById(input);
    if (!annotation) throw new AnnotationNotFoundError(input.id);
    return annotation;
  }

  list(input: ListAnnotationsInput): Promise<Annotation[]> {
    return this.repository.list(listAnnotationsInputSchema.parse(input));
  }

  listForProjection(input: {
    projectId: string;
    traceIds: string[];
    anchor?: "trace" | "all";
  }): Promise<ProjectionAnnotation[]> {
    return this.repository.listForProjection({
      ...input,
      anchor: input.anchor ?? "all",
    });
  }
}
