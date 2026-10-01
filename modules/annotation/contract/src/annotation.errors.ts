import { HandledError } from "@langwatch/handled-error";

export class AnnotationNotFoundError extends HandledError {
  declare readonly code: "annotation_not_found";

  constructor(id: string) {
    super("annotation_not_found", `Annotation ${id} was not found.`, {
      httpStatus: 404,
      fault: "customer",
      meta: { annotationId: id },
    });

    this.name = "AnnotationNotFoundError";
  }
}

export class AnnotationQueueMemberInvalidError extends HandledError {
  declare readonly code: "annotation_queue_member_invalid";

  constructor() {
    super(
      "annotation_queue_member_invalid",
      "One or more queue members are not in this organization",
      { httpStatus: 400, fault: "customer" },
    );

    this.name = "AnnotationQueueMemberInvalidError";
  }
}

export class AnnotationScoreInvalidError extends HandledError {
  declare readonly code: "annotation_score_invalid";

  constructor() {
    super("annotation_score_invalid", "One or more annotation scores are not in this project", {
      httpStatus: 400,
      fault: "customer",
    });

    this.name = "AnnotationScoreInvalidError";
  }
}

export class AnnotationScoreNotFoundError extends HandledError {
  declare readonly code: "annotation_score_not_found";

  constructor(scoreId: string) {
    super("annotation_score_not_found", `Annotation score ${scoreId} was not found.`, {
      httpStatus: 404,
      fault: "customer",
      meta: { scoreId },
    });

    this.name = "AnnotationScoreNotFoundError";
  }
}

export class AnnotationAnnotatorInvalidError extends HandledError {
  declare readonly code: "annotation_annotator_invalid";

  constructor() {
    super(
      "annotation_annotator_invalid",
      "One or more annotators are not available in this project",
      { httpStatus: 400, fault: "customer" },
    );

    this.name = "AnnotationAnnotatorInvalidError";
  }
}
