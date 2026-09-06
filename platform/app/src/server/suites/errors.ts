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

/**
 * Thrown when a suite declares a field whose identifier the grammar refuses:
 * a capital letter, a space, or a name the scenario already answers to.
 *
 * The identifier is on `meta` because the suite editor renders it beside the
 * row that carries it.
 */
export class SuiteFieldIdentifierInvalidError extends SuiteDomainError {
  declare readonly code: "suite_field_identifier_invalid";

  constructor({ identifier }: { identifier: string }) {
    super(`Field identifier cannot be used: ${identifier}`, {
      code: "suite_field_identifier_invalid",
      httpStatus: 422,
      meta: { identifier },
    });
    this.name = "SuiteFieldIdentifierInvalidError";
  }
}

/** Thrown when a suite declares one identifier twice. */
export class SuiteFieldIdentifierDuplicateError extends SuiteDomainError {
  declare readonly code: "suite_field_identifier_duplicate";

  constructor({ identifier }: { identifier: string }) {
    super(`Field identifier declared more than once: ${identifier}`, {
      code: "suite_field_identifier_duplicate",
      httpStatus: 422,
      meta: { identifier },
    });
    this.name = "SuiteFieldIdentifierDuplicateError";
  }
}

/**
 * Thrown when a field is removed while an attached evaluator still maps an
 * input to it. The evaluator ids are on `meta` so the editor can open the
 * offending attachment.
 */
export class SuiteFieldInUseError extends SuiteDomainError {
  declare readonly code: "suite_field_in_use";

  constructor({
    identifier,
    evaluatorIds,
  }: {
    identifier: string;
    evaluatorIds: string[];
  }) {
    super(`Field ${identifier} is read by an attached evaluator`, {
      code: "suite_field_in_use",
      httpStatus: 422,
      meta: { identifier, evaluatorIds },
    });
    this.name = "SuiteFieldInUseError";
  }
}

/** Thrown when an attachment names an evaluator the project does not hold. */
export class SuiteEvaluatorNotFoundError extends SuiteDomainError {
  declare readonly code: "suite_evaluator_not_found";

  constructor({ evaluatorId }: { evaluatorId: string }) {
    super(`Evaluator not found: ${evaluatorId}`, {
      code: "suite_evaluator_not_found",
      httpStatus: 422,
      meta: { evaluatorId },
    });
    this.name = "SuiteEvaluatorNotFoundError";
  }
}

/**
 * Thrown when a mapping names a path no source provides, or a scenario field
 * the suite does not declare.
 */
export class SuiteEvaluatorMappingInvalidError extends SuiteDomainError {
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
    super(`Mapping of ${input} cannot be read: ${reason}`, {
      code: "suite_evaluator_mapping_invalid",
      httpStatus: 422,
      meta: { evaluatorId, input },
    });
    this.name = "SuiteEvaluatorMappingInvalidError";
  }
}

/**
 * Refuses a run while an attached evaluator has a required input with no
 * mapping. Raised before anything is queued, so no run starts half configured.
 *
 * All three go on `meta` because the run dialog renders them: the evaluator
 * and the suite so it can open the attachment, the inputs so it can say what
 * is missing.
 */
export class SuiteEvaluatorMappingsMissingError extends SuiteDomainError {
  declare readonly code: "suite_evaluator_mappings_missing";

  constructor({
    evaluatorId,
    suiteId,
    inputs,
  }: {
    evaluatorId: string;
    /** The suite or plan the attachment lives on. */
    suiteId: string;
    inputs: string[];
  }) {
    super(`Evaluator is missing required mappings: ${inputs.join(", ")}`, {
      code: "suite_evaluator_mappings_missing",
      httpStatus: 422,
      meta: { evaluatorId, suiteId, inputs },
    });
    this.name = "SuiteEvaluatorMappingsMissingError";
  }
}
