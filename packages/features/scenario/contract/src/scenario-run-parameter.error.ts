import { HandledError, type HandledErrorOptions } from "@langwatch/handled-error";

import type { ScenarioContentField } from "./scenario-content-template";

type ScenarioParameterErrorCode =
  | "scenario_parameter_missing"
  | "scenario_parameter_template_invalid"
  | "scenario_parameter_unknown"
  | "scenario_secret_parameter_conflict"
  | "scenario_secret_parameter_in_text"
  | "scenario_secret_parameter_missing";

/**
 * Base for the ways a run's parameters can be wrong (ADR-045).
 *
 * `code` and `httpStatus` are required rather than defaulted: every one of
 * these is a distinct thing to tell the customer, and a base class that
 * guesses is a base class that eventually tells them the wrong one. `code` is
 * narrowed to this feature's public parameter error codes.
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

/**
 * Thrown when a run supplies a value for a name no scenario in it declares.
 *
 * Both lists are on `meta` because the run dialog renders them: the rejected
 * names so the customer can see their typo, and the declared ones so they can
 * see what they meant to type.
 */
export class ScenarioParameterUnknownError extends ScenarioParameterError {
  declare readonly code: "scenario_parameter_unknown";

  constructor({
    unknownKeys,
    declaredNames,
  }: {
    unknownKeys: string[];
    declaredNames: string[];
  }) {
    super({
      message: `Unknown scenario parameters: ${unknownKeys.join(", ")}. Declared: ${
        declaredNames.length > 0 ? declaredNames.join(", ") : "none"
      }`,
      code: "scenario_parameter_unknown",
      httpStatus: 422,
      meta: { unknownKeys, declaredNames },
    });
    this.name = "ScenarioParameterUnknownError";
  }
}

/**
 * Thrown when the scenario's own text references a parameter the run resolved
 * no value for.
 *
 * `field` says which piece of the scenario read it, so the dialog can point at
 * the situation or at the criterion by position instead of asking the customer
 * to search their own text.
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
 * Thrown when a scenario declares a secret parameter and the run supplied no
 * text value for it.
 *
 * A secret parameter has no default by design, so there is nothing to fall
 * back to. Only the names travel on the error: the value is the thing this
 * whole path exists to keep out of messages, logs and stores.
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
 * Thrown when one run covers a scenario that declares a name as secret and
 * another that declares the same name as plain.
 *
 * A run supplies one value per name. Accepting the pair would send a credential
 * to the plain scenario's `params` namespace, where it is rendered into the
 * scenario text and recorded on the run.
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
 *
 * The rendered text is handed to the simulated user and the judge and is
 * recorded with the run, so a secret read there is a secret written down.
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
 * Thrown when a scenario that declares parameters has text the template engine
 * cannot render, either because it is malformed or because it exhausts the
 * render limits.
 *
 * Only `field` is on `meta`: the engine's own message names its internals, so
 * it stays in the log line next to the throw.
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
