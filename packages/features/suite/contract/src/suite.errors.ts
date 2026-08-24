import { HandledError, NotFoundError } from "@langwatch/handled-error";

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
