import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class AnnotationQueueNameReservedError extends HandledError {
  declare readonly code: "annotation_queue_name_reserved";

  constructor(slug: string) {
    super("annotation_queue_name_reserved", "That annotation queue name is reserved", {
      httpStatus: 409,
      fault: "customer",
      meta: { slug },
    });

    this.name = "AnnotationQueueNameReservedError";
  }
}

export class AnnotationQueueNameTakenError extends HandledError {
  declare readonly code: "annotation_queue_name_taken";

  constructor(slug: string) {
    super("annotation_queue_name_taken", "An annotation queue with this name already exists", {
      httpStatus: 409,
      fault: "customer",
      meta: { slug },
    });

    this.name = "AnnotationQueueNameTakenError";
  }
}

export class AnnotationQueueItemNotFoundError extends NotFoundError {
  declare readonly code: "annotation_queue_item_not_found";

  constructor(queueItemId: string) {
    super("annotation_queue_item_not_found", "Queue item", queueItemId, {
      meta: { queueItemId },
    });

    this.name = "AnnotationQueueItemNotFoundError";
  }
}

export class AnnotationQueueNotFoundError extends NotFoundError {
  declare readonly code: "annotation_queue_not_found";

  constructor(queueId: string) {
    super("annotation_queue_not_found", "Annotation queue", queueId, { meta: { queueId } });
    this.name = "AnnotationQueueNotFoundError";
  }
}

export class AnnotationAnnotatorReferenceInvalidError extends HandledError {
  declare readonly code: "annotation_annotator_reference_invalid";

  constructor(annotator: string) {
    super("annotation_annotator_reference_invalid", "Invalid annotator", {
      httpStatus: 400,
      fault: "customer",
      meta: { annotator },
    });

    this.name = "AnnotationAnnotatorReferenceInvalidError";
  }
}
