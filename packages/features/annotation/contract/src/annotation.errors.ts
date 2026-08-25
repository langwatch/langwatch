import { HandledError } from "@langwatch/handled-error";

export class AnnotationNotFoundError extends Error {
  constructor(id: string) {
    super(`Annotation ${id} was not found.`);
    this.name = "AnnotationNotFoundError";
  }
}

export class AnnotationProjectNotFoundError extends HandledError {
  declare readonly code: "annotation_project_not_found";

  constructor(projectId: string) {
    super("annotation_project_not_found", "Project not found", {
      httpStatus: 404,
      fault: "customer",
      meta: { projectId },
    });
    this.name = "AnnotationProjectNotFoundError";
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
    super(
      "annotation_score_invalid",
      "One or more annotation scores are not in this project",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "AnnotationScoreInvalidError";
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
