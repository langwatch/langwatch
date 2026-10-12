import { NotFoundError } from "@langwatch/handled-error";

/**
 * Raised when an annotation id names nothing in the project: never created,
 * already deleted, or another project's. One refusal for all three, so a
 * caller cannot probe which ids exist elsewhere.
 */
export class AnnotationNotFoundError extends NotFoundError {
  declare readonly code: "annotation_not_found";

  constructor({ annotationId }: { annotationId: string }) {
    super("annotation_not_found", "Annotation", annotationId);
    this.name = "AnnotationNotFoundError";
  }
}
