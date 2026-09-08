import {
  AnnotationNotFoundError,
  annotationSchema,
  createAnnotationInputSchema,
  deleteAnnotationInputSchema,
  listAnnotationsInputSchema,
  listProjectionAnnotationsInputSchema,
  projectionAnnotationSchema,
  updateAnnotationInputSchema,
  type Annotation,
  type AnnotationByIdInput,
  type CreateAnnotationInput,
  type DeleteAnnotationInput,
  type ListAnnotationsInput,
  type ListProjectionAnnotationsInput,
  type ProjectionAnnotation,
  type UpdateAnnotationInput,
} from "@langwatch/annotation-contract";
import { nowInstant, toDate } from "@langwatch/time";
import type { AnnotationRepository } from "../annotation.repository.ts";

export class MemoryAnnotationRepository implements AnnotationRepository {
  #annotations = new Map<string, Annotation>();

  private constructor() {}

  static create(): MemoryAnnotationRepository {
    return new MemoryAnnotationRepository();
  }

  #key(projectId: string, annotationId: string): string {
    return `${projectId}:${annotationId}`;
  }

  async create(input: CreateAnnotationInput): Promise<Annotation> {
    const parsed = createAnnotationInputSchema.parse(input);
    const now = toDate(nowInstant());

    const annotation = annotationSchema.parse({
      ...parsed,
      userId: parsed.userId ?? null,
      email: parsed.email ?? null,
      anchorKind: parsed.anchorKind ?? null,
      anchorId: parsed.anchorId ?? null,
      anchorPath: parsed.anchorPath ?? null,
      createdAt: now,
      updatedAt: now,
    });

    this.#annotations.set(this.#key(annotation.projectId, annotation.id), annotation);

    return structuredClone(annotation);
  }

  async update(input: UpdateAnnotationInput): Promise<Annotation> {
    const parsed = updateAnnotationInputSchema.parse(input);
    const current = this.#annotations.get(this.#key(parsed.projectId, parsed.id));

    const isMissingOrMismatched =
      !current ||
      current.projectId !== parsed.projectId ||
      (parsed.traceId !== void 0 && parsed.traceId !== current.traceId);

    if (isMissingOrMismatched) {
      throw new AnnotationNotFoundError(parsed.id);
    }

    const annotation = annotationSchema.parse({
      ...current,
      traceId: parsed.traceId === undefined ? current.traceId : parsed.traceId,
      comment: parsed.comment,
      isThumbsUp: parsed.isThumbsUp === undefined ? current.isThumbsUp : parsed.isThumbsUp,
      email: parsed.email === undefined ? current.email : parsed.email,
      scoreOptions: parsed.scoreOptions === undefined ? current.scoreOptions : parsed.scoreOptions,
      expectedOutput:
        parsed.expectedOutput === undefined ? current.expectedOutput : parsed.expectedOutput,
      updatedAt: toDate(nowInstant()),
    });

    this.#annotations.set(this.#key(annotation.projectId, annotation.id), annotation);

    return structuredClone(annotation);
  }

  async delete(input: DeleteAnnotationInput): Promise<Annotation> {
    const parsed = deleteAnnotationInputSchema.parse(input);
    const annotation = this.#annotations.get(this.#key(parsed.projectId, parsed.id));

    if (!annotation || annotation.projectId !== parsed.projectId) {
      throw new AnnotationNotFoundError(parsed.id);
    }

    this.#annotations.delete(this.#key(parsed.projectId, parsed.id));

    return structuredClone(annotation);
  }

  async getById(input: AnnotationByIdInput): Promise<Annotation> {
    const annotation = this.#annotations.get(this.#key(input.projectId, input.id));

    if (!annotation || annotation.projectId !== input.projectId) {
      throw new AnnotationNotFoundError(input.id);
    }

    return structuredClone(annotation);
  }

  async list(input: ListAnnotationsInput): Promise<Annotation[]> {
    const parsed = listAnnotationsInputSchema.parse(input);

    const rows = [...this.#annotations.values()].filter((annotation) =>
      this.#matchesListFilter(annotation, parsed),
    );

    if (parsed.order) {
      rows.sort(
        (a, b) =>
          (parsed.order === "asc" ? -1 : 1) * (a.createdAt.getTime() - b.createdAt.getTime()),
      );
    }

    return rows.map((annotation) => structuredClone(annotation));
  }

  #matchesListFilter(annotation: Annotation, input: ListAnnotationsInput): boolean {
    if (annotation.projectId !== input.projectId) return false;

    if (input.traceIds && !input.traceIds.includes(annotation.traceId)) return false;

    if (input.anchor === "trace" && annotation.anchorKind !== null) return false;

    if (input.startDate && annotation.createdAt < input.startDate) return false;

    if (input.endDate && annotation.createdAt > input.endDate) return false;

    return true;
  }

  async listForProjection(input: ListProjectionAnnotationsInput): Promise<ProjectionAnnotation[]> {
    const parsed = listProjectionAnnotationsInputSchema.parse(input);

    return [...this.#annotations.values()]
      .filter(
        (annotation) =>
          annotation.projectId === parsed.projectId &&
          parsed.traceIds.includes(annotation.traceId) &&
          (parsed.anchor !== "trace" || annotation.anchorKind === null),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((annotation) =>
        projectionAnnotationSchema.parse({
          id: annotation.id,
          traceId: annotation.traceId,
          isThumbsUp: annotation.isThumbsUp,
          comment: annotation.comment,
          expectedOutput: annotation.expectedOutput,
          scoreOptions: annotation.scoreOptions,
          createdAt: annotation.createdAt,
          anchorKind: annotation.anchorKind,
          anchorId: annotation.anchorId,
          anchorPath: annotation.anchorPath,
        }),
      );
  }
}
