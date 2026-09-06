/**
 * Handled errors for the suite domain (ADR-045).
 *
 * These were plain `extends Error` classes, which meant the only thing that
 * reached the client was prose — and the client duly branched on it
 * (`err.message.includes("All scenarios")`). That is exactly the "parsing
 * prose" the handled-error contract exists to remove: each of these now
 * carries a stable `code` the UI keys its copy off.
 */
import {
  HandledError,
  type HandledErrorOptions,
} from "@langwatch/handled-error";

import type { AppErrorCode } from "~/features/errors/logic/codes";

/**
 * Base class for suite domain errors.
 *
 * `code` and `httpStatus` are REQUIRED, and both for the same reason: a
 * catch-all default whose copy asserts a specific cause is how a name clash
 * ends up telling the user "Run plan not found". This class used to default to
 * `suite_not_found`/404, so `new SuiteDomainError("…")` for any new failure
 * silently became a 404 claiming the suite was missing. There is nothing this
 * base class knows about an unspecified failure, so it refuses to guess —
 * "missing" is now {@link SuiteNotFoundError}, which says so in its name.
 *
 * `code` is narrowed to `AppErrorCode` rather than left as `string`: an
 * unconstrained code is one the presentation registry is not exhaustive over,
 * which is a customer reading a raw slug with no copy behind it.
 */
export class SuiteDomainError extends HandledError {
  constructor(
    message: string,
    options: HandledErrorOptions & {
      code: AppErrorCode;
      httpStatus: number;
    },
  ) {
    const { code, httpStatus, ...rest } = options;
    super(code, message, { ...rest, httpStatus });
    this.name = "SuiteDomainError";
  }
}

/** Thrown when the requested suite does not exist in the project */
export class SuiteNotFoundError extends SuiteDomainError {
  declare readonly code: "suite_not_found";

  constructor(message = "Suite not found") {
    super(message, { code: "suite_not_found", httpStatus: 404 });
    this.name = "SuiteNotFoundError";
  }
}

/**
 * Thrown when a suite references scenarios that do not exist.
 *
 * The offending ids are in the message (for the log line) and nowhere else:
 * `meta` is a client contract, and no component or agent reads these back, so
 * carrying them there would be debug context masquerading as one.
 */
export class InvalidScenarioReferencesError extends SuiteDomainError {
  declare readonly code: "suite_invalid_scenario_references";
  readonly invalidIds: string[];

  constructor({ invalidIds }: { invalidIds: string[] }) {
    super(`Invalid scenario references: ${invalidIds.join(", ")}`, {
      code: "suite_invalid_scenario_references",
      httpStatus: 422,
    });
    this.name = "InvalidScenarioReferencesError";
    this.invalidIds = invalidIds;
  }
}

/** Thrown when a suite references targets that do not exist. See above re `meta`. */
export class InvalidTargetReferencesError extends SuiteDomainError {
  declare readonly code: "suite_invalid_target_references";
  readonly invalidIds: string[];

  constructor({ invalidIds }: { invalidIds: string[] }) {
    super(`Invalid target references: ${invalidIds.join(", ")}`, {
      code: "suite_invalid_target_references",
      httpStatus: 422,
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

/**
 * Thrown when a run is requested for a suite that has no target at all.
 *
 * Distinct from {@link AllTargetsArchivedError}: that one says the targets the
 * suite had are gone, this one says none were ever chosen. A test suite starts
 * with no targets and gets them from the run dialog, so this is the expected
 * first-run state, not a broken reference.
 */
export class SuiteTargetsRequiredError extends SuiteDomainError {
  declare readonly code: "suite_targets_required";

  constructor() {
    super("This suite has no target to run against. Choose one, then run.", {
      code: "suite_targets_required",
      httpStatus: 422,
    });
    this.name = "SuiteTargetsRequiredError";
  }
}

/**
 * Thrown when a run plan's scope covers no scenario at all.
 *
 * Distinct from {@link AllScenariosArchivedError}: that one says the scenarios the
 * plan named are archived, this one says the rule the plan carries matches
 * nothing right now, which a new label or an emptied test suite can cause
 * without any scenario being archived.
 */
export class SuiteScopeEmptyError extends SuiteDomainError {
  declare readonly code: "suite_scope_empty";

  constructor() {
    super("This run plan covers no scenario. Widen its scope, then run.", {
      code: "suite_scope_empty",
      httpStatus: 422,
    });
    this.name = "SuiteScopeEmptyError";
  }
}

/** Thrown when a scope is written on a suite whose membership is its filing. */
export class SuiteScopeNotAllowedError extends SuiteDomainError {
  declare readonly code: "suite_scope_not_allowed";

  constructor() {
    super(
      "A test suite runs the scenarios filed in it, so it takes no scope.",
      {
        code: "suite_scope_not_allowed",
        httpStatus: 422,
      },
    );
    this.name = "SuiteScopeNotAllowedError";
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
