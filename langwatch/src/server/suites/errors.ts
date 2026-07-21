/**
 * Handled errors for the suite domain (ADR-045).
 *
 * These were plain `extends Error` classes, which meant the only thing that
 * reached the client was prose — and the client duly branched on it
 * (`err.message.includes("All scenarios")`). That is exactly the "parsing
 * prose" the handled-error contract exists to remove: each of these now
 * carries a stable `code` the UI keys its copy off.
 */
import { HandledError, type HandledErrorOptions } from "@langwatch/handled-error";

/**
 * Base class for suite domain errors.
 *
 * Defaults to `suite_not_found`/404, which is what a bare `SuiteDomainError`
 * is raised for. Anything that is not "missing" declares its own code — a
 * catch-all default whose copy asserts a specific cause is how a name clash
 * ends up telling the user "Run plan not found".
 */
export class SuiteDomainError extends HandledError {
  constructor(
    message: string,
    options: HandledErrorOptions & { code?: string; httpStatus?: number } = {},
  ) {
    const { code = "suite_not_found", httpStatus = 404, ...rest } = options;
    super(code, message, { ...rest, httpStatus });
    this.name = "SuiteDomainError";
  }
}

/** Thrown when a suite references scenarios that do not exist */
export class InvalidScenarioReferencesError extends SuiteDomainError {
  declare readonly code: "suite_invalid_scenario_references";
  readonly invalidIds: string[];

  constructor({ invalidIds }: { invalidIds: string[] }) {
    super(`Invalid scenario references: ${invalidIds.join(", ")}`, {
      code: "suite_invalid_scenario_references",
      httpStatus: 422,
      meta: { invalidIds },
    });
    this.name = "InvalidScenarioReferencesError";
    this.invalidIds = invalidIds;
  }
}

/** Thrown when a suite references targets that do not exist */
export class InvalidTargetReferencesError extends SuiteDomainError {
  declare readonly code: "suite_invalid_target_references";
  readonly invalidIds: string[];

  constructor({ invalidIds }: { invalidIds: string[] }) {
    super(`Invalid target references: ${invalidIds.join(", ")}`, {
      code: "suite_invalid_target_references",
      httpStatus: 422,
      meta: { invalidIds },
    });
    this.name = "InvalidTargetReferencesError";
    this.invalidIds = invalidIds;
  }
}

/** Thrown when all scenarios in a suite are archived */
export class AllScenariosArchivedError extends SuiteDomainError {
  declare readonly code: "suite_all_scenarios_archived";

  constructor() {
    super(
      "All scenarios in this suite are archived. Update the suite to include active scenarios.",
      { code: "suite_all_scenarios_archived", httpStatus: 422 },
    );
    this.name = "AllScenariosArchivedError";
  }
}

/** Thrown when all targets in a suite are archived */
export class AllTargetsArchivedError extends SuiteDomainError {
  declare readonly code: "suite_all_targets_archived";

  constructor() {
    super(
      "All targets in this suite are archived. Update the suite to include active targets.",
      { code: "suite_all_targets_archived", httpStatus: 422 },
    );
    this.name = "AllTargetsArchivedError";
  }
}

/** Thrown when a suite name is already in use within the project */
export class SuiteNameTakenError extends SuiteDomainError {
  declare readonly code: "suite_name_taken";

  constructor() {
    super("A suite with this name already exists", {
      code: "suite_name_taken",
      httpStatus: 409,
    });
    this.name = "SuiteNameTakenError";
  }
}
