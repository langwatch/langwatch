import { HandledError } from "@langwatch/handled-error";

/**
 * Thrown when an export is requested without a session.
 *
 * Thrown rather than returned as `c.json`: the secured app installs
 * `onError(handleError)`, which serializes a HandledError into a response
 * carrying its `httpStatus` alongside trace/span ids and the structured error
 * shape. A hand-rolled `c.json({ error }, { status: 401 })` drops all of that,
 * so a failed export is not correlatable to a trace.
 */
export class ScenarioRunExportUnauthenticatedError extends HandledError {
  declare readonly code: "scenario_run_export_unauthenticated";

  constructor() {
    super(
      "scenario_run_export_unauthenticated",
      "You must be logged in to export scenario runs.",
      { httpStatus: 401 },
    );
  }
}

/**
 * Thrown when the session is valid but lacks `scenarios:view` on the project.
 *
 * Distinct from the unauthenticated case so the caller can tell "log in" from
 * "ask for access" — and so the audit trail records which permission was the
 * blocker rather than a bare 403.
 */
export class ScenarioRunExportForbiddenError extends HandledError {
  declare readonly code: "scenario_run_export_forbidden";

  constructor(projectId: string) {
    super(
      "scenario_run_export_forbidden",
      "You do not have permission to export scenario runs for this project.",
      {
        httpStatus: 403,
        meta: { projectId, permission: "scenarios:view" },
      },
    );
  }
}
