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
import { generate } from "@langwatch/ksuid";

import type { AnnotationRepository } from "../repositories/annotation.repository.ts";
import type { AnnotationFactsService } from "./annotation-facts.service.ts";

/** Every write is recorded as annotation's fact once it is stored; a refused write records none. */
export class AnnotationService {
  #repository: AnnotationRepository;
  #facts: AnnotationFactsService;

  private constructor(repository: AnnotationRepository, facts: AnnotationFactsService) {
    this.#repository = repository;
    this.#facts = facts;
  }

  static create({
    repository,
    facts,
  }: {
    repository: AnnotationRepository;
    facts: AnnotationFactsService;
  }): AnnotationService {
    return new AnnotationService(repository, facts);
  }

  create(input: CreateAnnotationInput): Promise<Annotation> {
    return this.#recordCreated(this.#repository.create(createAnnotationInputSchema.parse(input)));
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
    return this.#recordUpdated(this.#repository.update(updateAnnotationInputSchema.parse(input)));
  }

  delete(input: DeleteAnnotationInput): Promise<Annotation> {
    return this.#recordDeleted(this.#repository.delete(deleteAnnotationInputSchema.parse(input)));
  }

  getById(input: AnnotationByIdInput): Promise<Annotation> {
    const parsed = annotationByIdInputSchema.parse(input);

    return this.#repository.findById(parsed);
  }

  list(input: ListAnnotationsInput): Promise<Annotation[]> {
    return this.#repository.findAll(listAnnotationsInputSchema.parse(input));
  }

  listForProjection(input: ListProjectionAnnotationsInput): Promise<ProjectionAnnotation[]> {
    return this.#repository.findForProjection(listProjectionAnnotationsInputSchema.parse(input));
  }

  async #recordCreated(write: Promise<Annotation>): Promise<Annotation> {
    const annotation = await write;
    await this.#facts.annotationCreated({ annotation });
    return annotation;
  }

  async #recordUpdated(write: Promise<Annotation>): Promise<Annotation> {
    const annotation = await write;
    await this.#facts.annotationUpdated({ annotation });
    return annotation;
  }

  async #recordDeleted(write: Promise<Annotation>): Promise<Annotation> {
    const annotation = await write;
    await this.#facts.annotationDeleted({ annotation });
    return annotation;
  }
}
