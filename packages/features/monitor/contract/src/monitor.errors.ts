import { HandledError, remediation } from "@langwatch/handled-error";
import type { ZodError } from "zod";

export class MonitorNotFoundError extends HandledError {
  declare readonly code: "monitor_not_found";

  constructor(readonly monitorId: string) {
    super("monitor_not_found", "Monitor not found.", {
      httpStatus: 404,
      fault: "customer",
      meta: { monitorId },
    });
    this.name = "MonitorNotFoundError";
  }
}

export class MonitorEvaluatorRequiredError extends HandledError {
  declare readonly code: "monitor_evaluator_required";

  constructor() {
    super(
      "monitor_evaluator_required",
      "An evaluator is required to create an online evaluation.",
      { httpStatus: 400, fault: "customer", ...remediation("monitor_evaluator_required") },
    );
    this.name = "MonitorEvaluatorRequiredError";
  }
}

/** The monitor names a check this platform runs no evaluator for. */
export class MonitorCheckTypeUnknownError extends HandledError {
  declare readonly code: "monitor_check_type_unknown";

  constructor(readonly checkType: string) {
    super("monitor_check_type_unknown", "Invalid checkType.", {
      httpStatus: 400,
      fault: "customer",
      meta: { checkType },
    });
    this.name = "MonitorCheckTypeUnknownError";
  }
}

/** The settings do not match the schema the named evaluator declares. */
export class MonitorCheckSettingsInvalidError extends HandledError {
  declare readonly code: "monitor_check_settings_invalid";

  constructor(checkType: string, cause: ZodError) {
    super("monitor_check_settings_invalid", "Invalid settings for this evaluator.", {
      httpStatus: 400,
      fault: "customer",
      meta: { checkType, fields: cause.issues.map((issue) => issue.path.join(".")) },
    });
    this.name = "MonitorCheckSettingsInvalidError";
  }
}

/** The caller may manage evaluations here, but not in the project copied from. */
export class MonitorSourceProjectForbiddenError extends HandledError {
  declare readonly code: "monitor_source_project_forbidden";

  constructor(readonly sourceProjectId: string) {
    super(
      "monitor_source_project_forbidden",
      "You do not have permission to manage evaluations in the source project.",
      { httpStatus: 403, fault: "customer", meta: { sourceProjectId } },
    );
    this.name = "MonitorSourceProjectForbiddenError";
  }
}
