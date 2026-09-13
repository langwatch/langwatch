/**
 * Handled errors for suite fields and evaluator attachments: a write that
 * violates the field grammar or the mapping rules refuses with one of these,
 * naming what a caller can fix.
 *
 * @see specs/suites/test-suites.feature
 * @see specs/scenarios/scenario-fields.feature
 */

import { HandledError } from "@langwatch/handled-error";

export class SuiteFieldIdentifierInvalidError extends HandledError {
  declare readonly code: "suite_field_identifier_invalid";

  constructor({ identifier }: { identifier: string }) {
    super(
      "suite_field_identifier_invalid",
      `"${identifier}" is not a valid field identifier.`,
      { httpStatus: 422, fault: "customer", meta: { identifier } },
    );
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

  constructor({
    identifier,
    evaluatorIds,
  }: {
    identifier: string;
    evaluatorIds: string[];
  }) {
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
