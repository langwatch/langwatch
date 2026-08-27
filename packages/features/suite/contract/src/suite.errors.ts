import { HandledError, NotFoundError, ValidationError } from "@langwatch/handled-error";

export class SuiteNotFoundError extends NotFoundError {
  declare readonly code: "suite_not_found";

  constructor(id: string) {
    super("suite_not_found", "Suite", id);
    this.name = "SuiteNotFoundError";
  }
}

export class SuiteNameTakenError extends HandledError {
  declare readonly code: "suite_name_taken";

  constructor(name: string) {
    super("suite_name_taken", `A suite named "${name}" already exists.`, {
      httpStatus: 409,
      fault: "customer",
    });
    this.name = "SuiteNameTakenError";
  }
}

/** A suite execution was rejected before any work was scheduled. */
export class SuiteExecutionError extends HandledError {
  constructor(code: string, message: string) {
    super(code, message, { httpStatus: 422, fault: "customer" });
    this.name = "SuiteExecutionError";
  }
}

export class InvalidScenarioReferencesError extends SuiteExecutionError {
  readonly invalidIds: string[];

  constructor(input: { invalidIds: string[] }) {
    super(
      "suite_invalid_scenario_references",
      `Invalid scenario references: ${input.invalidIds.join(", ")}`,
    );
    this.name = "InvalidScenarioReferencesError";
    this.invalidIds = input.invalidIds;
  }
}

export class InvalidTargetReferencesError extends SuiteExecutionError {
  readonly invalidIds: string[];

  constructor(input: { invalidIds: string[] }) {
    super(
      "suite_invalid_target_references",
      `Invalid target references: ${input.invalidIds.join(", ")}`,
    );
    this.name = "InvalidTargetReferencesError";
    this.invalidIds = input.invalidIds;
  }
}

export class AllScenariosArchivedError extends SuiteExecutionError {
  constructor() {
    super(
      "suite_all_scenarios_archived",
      "All scenarios in this suite are archived. Update the suite to include active scenarios.",
    );
    this.name = "AllScenariosArchivedError";
  }
}

export class AllTargetsArchivedError extends SuiteExecutionError {
  constructor() {
    super(
      "suite_all_targets_archived",
      "All targets in this suite are archived. Update the suite to include active targets.",
    );
    this.name = "AllTargetsArchivedError";
  }
}

export class SuiteTargetsRequiredError extends SuiteExecutionError {
  constructor() {
    super(
      "suite_targets_required",
      "This suite has no target to run against. Choose one, then run.",
    );
    this.name = "SuiteTargetsRequiredError";
  }
}

export class SuiteScopeEmptyError extends SuiteExecutionError {
  constructor() {
    super("suite_scope_empty", "This run plan covers no test case. Widen its scope, then run.");
    this.name = "SuiteScopeEmptyError";
  }
}

export class SuiteScopeNotAllowedError extends SuiteExecutionError {
  constructor() {
    super(
      "suite_scope_not_allowed",
      "A test suite runs the test cases filed in it, so it takes no scope.",
    );
    this.name = "SuiteScopeNotAllowedError";
  }
}

export class SuiteFolderMembershipManagedError extends ValidationError {
  constructor() {
    const message = "A folder's scenarios are managed by filing scenarios into it";
    super(message, {
      meta: { fieldErrors: { scenarioIds: [message] } },
    });
    this.name = "SuiteFolderMembershipManagedError";
  }
}
