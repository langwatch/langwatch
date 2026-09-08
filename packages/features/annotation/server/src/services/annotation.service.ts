import {
  ANNOTATION_KSUID_RESOURCE,
  annotationByIdInputSchema,
  createAnnotationInputSchema,
  createUnattributedAnnotationSchema,
  deleteAnnotationInputSchema,
  listAnnotationsInputSchema,
  listProjectionAnnotationsInputSchema,
  updateAnnotationInputSchema,
  type Annotation,
  type AnnotationByIdInput,
  type CreateAnnotationInput,
  type CreateUnattributedAnnotationInput,
  type DeleteAnnotationInput,
  type ListAnnotationsInput,
  type ListProjectionAnnotationsInput,
  type ProjectionAnnotation,
  type UpdateAnnotationInput,
} from "@langwatch/annotation-contract";
import type { AnnotationRepository } from "../repositories/annotation.repository.ts";
import { generate } from "@langwatch/ksuid";

export class AnnotationService {
  #repository: AnnotationRepository;

  private constructor(repository: AnnotationRepository) {
    this.#repository = repository;
  }

  static create({ repository }: { repository: AnnotationRepository }): AnnotationService {
    return new AnnotationService(repository);
  }

  create(input: CreateAnnotationInput): Promise<Annotation> {
    return this.#repository.create(createAnnotationInputSchema.parse(input));
  }

  createUnattributed(input: CreateUnattributedAnnotationInput): Promise<Annotation> {
    const parsed = createUnattributedAnnotationSchema.parse(input);

    return this.create({
      ...parsed,
      id: generate(ANNOTATION_KSUID_RESOURCE).toString(),
      userId: null,
      scoreOptions: {},
      expectedOutput: null,
    });
  }

  update(input: UpdateAnnotationInput): Promise<Annotation> {
    return this.#repository.update(updateAnnotationInputSchema.parse(input));
  }

  delete(input: DeleteAnnotationInput): Promise<Annotation> {
    return this.#repository.delete(deleteAnnotationInputSchema.parse(input));
  }

  getById(input: AnnotationByIdInput): Promise<Annotation> {
    const parsed = annotationByIdInputSchema.parse(input);

    return this.#repository.getById(parsed);
  }

  list(input: ListAnnotationsInput): Promise<Annotation[]> {
    return this.#repository.list(listAnnotationsInputSchema.parse(input));
  }

  listForProjection(input: ListProjectionAnnotationsInput): Promise<ProjectionAnnotation[]> {
    return this.#repository.listForProjection(listProjectionAnnotationsInputSchema.parse(input));
  }
}
