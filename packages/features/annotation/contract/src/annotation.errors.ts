export class AnnotationNotFoundError extends Error {
  constructor(id: string) {
    super(`Annotation ${id} was not found.`);
    this.name = "AnnotationNotFoundError";
  }
}
