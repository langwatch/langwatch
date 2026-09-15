import { HandledError, type HandledErrorOptions } from "@langwatch/handled-error";

import type { ScenarioParameterValue } from "./scenario.parameters.ts";
import type { ScenarioContentField } from "./scenario-content-template.ts";

type ScenarioParameterErrorCode =
  | "scenario_parameter_missing"
  | "scenario_parameter_option_invalid"
  | "scenario_parameter_required"
  | "scenario_parameter_template_invalid"
  | "scenario_parameter_unknown"
  | "scenario_secret_parameter_conflict"
  | "scenario_secret_parameter_in_text"
  | "scenario_secret_parameter_missing";

/**
 * Base for the ways a run's parameters can be wrong (ADR-045). `code` and
 * `httpStatus` are required, not defaulted, so each subclass names its own
 * customer-facing case; `code` narrows to this feature's parameter codes.
 */
export class ScenarioParameterError extends HandledError {
  constructor({
    message,
    code,
    httpStatus,
    ...rest
  }: HandledErrorOptions & {
    message: string;
    code: ScenarioParameterErrorCode;
    httpStatus: number;
  }) {
    super(code, message, { ...rest, httpStatus });
    this.name = "ScenarioParameterError";
  }
}

/** Thrown when run supplies value for undeclared name; includes unknown keys,
 * declared names, and target label on meta for the run dialog.
 */
export class ScenarioParameterUnknownError extends ScenarioParameterError {
  declare readonly code: "scenario_parameter_unknown";

  constructor({
    unknownKeys,
    declaredNames,
    targetLabel,
  }: {
    unknownKeys: string[];
    declaredNames: string[];
    /** The target the run was refused for, when the run names one. */
    targetLabel?: string;
  }) {
    super({
      message: `Unknown scenario parameters: ${unknownKeys.join(", ")}. Declared: ${
        declaredNames.length > 0 ? declaredNames.join(", ") : "none"
      }`,
      code: "scenario_parameter_unknown",
      httpStatus: 422,
      meta: {
        unknownKeys,
        declaredNames,
        ...(targetLabel ? { targetLabel } : {}),
      },
    });
    this.name = "ScenarioParameterUnknownError";
  }
}

/**
 * Thrown when a run's value falls outside a parameter's closed option list.
 * The options live on `meta` because the run dialog renders them, so the
 * customer sees what was accepted next to the value that was refused.
 */
export class ScenarioParameterOptionInvalidError extends ScenarioParameterError {
  declare readonly code: "scenario_parameter_option_invalid";

  constructor({
    name,
    value,
    options,
  }: {
    name: string;
    value: ScenarioParameterValue;
    options: ScenarioParameterValue[];
  }) {
    super({
      message: `The value of "${name}" is not one of its options: ${options
        .map((option) => String(option))
        .join(", ")}`,
      code: "scenario_parameter_option_invalid",
      httpStatus: 422,
      meta: { name, value, options },
    });
    this.name = "ScenarioParameterOptionInvalidError";
  }
}

/** Required parameter without value; declared by connected agent for
 * parameters with no code default. Names on meta for run dialog.
 */
export class ScenarioParameterRequiredError extends ScenarioParameterError {
  declare readonly code: "scenario_parameter_required";

  constructor({ names }: { names: string[] }) {
    super({
      message: `No value for required scenario parameters: ${names.join(", ")}`,
      code: "scenario_parameter_required",
      httpStatus: 422,
      meta: { names },
    });
    this.name = "ScenarioParameterRequiredError";
  }
}

/**
 * Thrown when the scenario's own text references a parameter with no
 * resolved value. `field` says which piece read it, so the dialog can point
 * at the situation or criterion instead of making the customer search for it.
 */
export class ScenarioParameterMissingError extends ScenarioParameterError {
  declare readonly code: "scenario_parameter_missing";

  constructor({ names, field }: { names: string[]; field: ScenarioContentField }) {
    super({
      message: `No value for scenario parameters referenced in ${field}: ${names.join(", ")}`,
      code: "scenario_parameter_missing",
      httpStatus: 422,
      meta: { names, field },
    });
    this.name = "ScenarioParameterMissingError";
  }
}

/**
 * Thrown when a scenario declares a secret parameter with no supplied value.
 * Secret parameters have no default; only the names travel on the error, to
 * keep the value out of messages, logs and stores.
 */
export class ScenarioSecretParameterMissingError extends ScenarioParameterError {
  declare readonly code: "scenario_secret_parameter_missing";

  constructor({ names }: { names: string[] }) {
    super({
      message: `No value supplied for secret scenario parameters: ${names.join(", ")}`,
      code: "scenario_secret_parameter_missing",
      httpStatus: 422,
      meta: { names },
    });
    this.name = "ScenarioSecretParameterMissingError";
  }
}

/**
 * Thrown when one run covers a scenario declaring a name as secret and
 * another as plain: accepting one value would send a credential into the
 * plain scenario's rendered text and recorded run.
 */
export class ScenarioSecretParameterConflictError extends ScenarioParameterError {
  declare readonly code: "scenario_secret_parameter_conflict";

  constructor({ names }: { names: string[] }) {
    super({
      message: `Declared as secret by one scenario and as plain by another: ${names.join(", ")}`,
      code: "scenario_secret_parameter_conflict",
      httpStatus: 422,
      meta: { names },
    });
    this.name = "ScenarioSecretParameterConflictError";
  }
}

/**
 * Thrown when a scenario's own situation or criteria read a secret parameter.
 * The rendered text goes to the simulated user and the judge and is recorded
 * with the run, so a secret read there is a secret written down.
 */
export class ScenarioSecretParameterInTextError extends ScenarioParameterError {
  declare readonly code: "scenario_secret_parameter_in_text";

  constructor({ names, field }: { names: string[]; field: ScenarioContentField }) {
    super({
      message: `A secret parameter cannot be read from scenario text. ${field} reads: ${names.join(", ")}`,
      code: "scenario_secret_parameter_in_text",
      httpStatus: 422,
      meta: { names, field },
    });
    this.name = "ScenarioSecretParameterInTextError";
  }
}

/**
 * Thrown when a scenario's text fails to render, malformed or over the
 * render limits. Only `field` is on `meta` — the engine's own message names
 * its internals, so it stays in the log line next to the throw.
 */
export class ScenarioParameterTemplateInvalidError extends ScenarioParameterError {
  declare readonly code: "scenario_parameter_template_invalid";

  constructor({ field }: { field: ScenarioContentField }) {
    super({
      message: `Scenario ${field} could not be rendered`,
      code: "scenario_parameter_template_invalid",
      httpStatus: 422,
      meta: { field },
    });
    this.name = "ScenarioParameterTemplateInvalidError";
  }
}
