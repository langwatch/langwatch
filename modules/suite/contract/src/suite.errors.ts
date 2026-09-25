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

export class SuiteTestSuiteMembershipManagedError extends ValidationError {
  constructor() {
    const message = "A test suite's scenarios are managed by filing scenarios into it";
    super(message, {
      meta: { fieldErrors: { scenarioIds: [message] } },
    });
    this.name = "SuiteTestSuiteMembershipManagedError";
  }
}

/**
 * A suite run cannot be scheduled on this process. See the file header for
 * why: the seam from a queued suite run to the scenario module's own event
 * stream is not yet decided.
 */
export class SuiteExecutionUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "Starting a suite run is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "SuiteExecutionUnavailableError";
  }
}

/**
 * The project exists but no organization can be resolved behind it.
 */
export class OrganizationNotFoundForProjectError extends HandledError {
  declare readonly code: "organization_not_found_for_project";

  constructor(projectId: string) {
    super("organization_not_found_for_project", "Organization not found for project", {
      httpStatus: 404,
      meta: { projectId },
    });
    this.name = "OrganizationNotFoundForProjectError";
  }
}

/** A refused run, at the status this family publishes one with. */
export class SuiteAliasRunRefusedError extends HandledError {
  constructor(refusal: SuiteExecutionError) {
    super(refusal.code, refusal.message, {
      httpStatus: 400,
      fault: refusal.fault,
      meta: refusal.meta,
      tips: refusal.tips,
    });
    this.name = "SuiteAliasRunRefusedError";
  }
}

export class SuiteFieldIdentifierInvalidError extends HandledError {
  declare readonly code: "suite_field_identifier_invalid";

  constructor({ identifier }: { identifier: string }) {
    super("suite_field_identifier_invalid", `"${identifier}" is not a valid field identifier.`, {
      httpStatus: 422,
      fault: "customer",
      meta: { identifier },
    });
    this.name = "SuiteFieldIdentifierInvalidError";
  }
}

export class SuiteFieldIdentifierDuplicateError extends HandledError {
  declare readonly code: "suite_field_identifier_duplicate";

  constructor({ identifier }: { identifier: string }) {
    super(
      "suite_field_identifier_duplicate",
      `Two fields cannot share the identifier "${identifier}".`,
      { httpStatus: 422, fault: "customer", meta: { identifier } },
    );
    this.name = "SuiteFieldIdentifierDuplicateError";
  }
}

export class SuiteEvaluatorNotFoundError extends HandledError {
  declare readonly code: "suite_evaluator_not_found";

  constructor({ evaluatorId }: { evaluatorId: string }) {
    super(
      "suite_evaluator_not_found",
      `Evaluator "${evaluatorId}" was not found in this project.`,
      { httpStatus: 404, fault: "customer", meta: { evaluatorId } },
    );
    this.name = "SuiteEvaluatorNotFoundError";
  }
}

export class SuiteEvaluatorMappingInvalidError extends HandledError {
  declare readonly code: "suite_evaluator_mapping_invalid";

  constructor({
    evaluatorId,
    input,
    reason,
  }: {
    evaluatorId: string;
    input: string;
    reason: string;
  }) {
    super(
      "suite_evaluator_mapping_invalid",
      `The mapping for "${input}" on evaluator "${evaluatorId}" is invalid: ${reason}`,
      { httpStatus: 422, fault: "customer", meta: { evaluatorId, input } },
    );
    this.name = "SuiteEvaluatorMappingInvalidError";
  }
}

export class SuiteFieldInUseError extends HandledError {
  declare readonly code: "suite_field_in_use";

  constructor({ identifier, evaluatorIds }: { identifier: string; evaluatorIds: string[] }) {
    super(
      "suite_field_in_use",
      `The field "${identifier}" is still read by an evaluator mapping.`,
      {
        httpStatus: 422,
        fault: "customer",
        meta: { identifier, evaluatorIds },
      },
    );
    this.name = "SuiteFieldInUseError";
  }
}
