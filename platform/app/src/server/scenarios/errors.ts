/**
 * Custom error types for scenario domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */

import {
  HandledError,
  type HandledErrorOptions,
} from "@langwatch/handled-error";

import type { AppErrorCode } from "~/features/errors/logic/codes";
import type { ScenarioContentField } from "./execution/scenario-content-template";

export class ScenarioNotFoundError extends Error {
  constructor(message = "Scenario not found") {
    super(message);
    this.name = "ScenarioNotFoundError";
  }
}

/**
 * Base for the ways a run's parameters can be wrong (ADR-045).
 *
 * `code` and `httpStatus` are required rather than defaulted: every one of
 * these is a distinct thing to tell the customer, and a base class that
 * guesses is a base class that eventually tells them the wrong one. `code` is
 * narrowed to {@link AppErrorCode} so the presentation registry stays
 * exhaustive over what this domain can raise.
 */
export class ScenarioParameterError extends HandledError {
  constructor(
    message: string,
    options: HandledErrorOptions & {
      code: AppErrorCode;
      httpStatus: number;
    },
  ) {
    const { code, httpStatus, ...rest } = options;
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
    super(
      `Unknown scenario parameters: ${unknownKeys.join(", ")}. Declared: ${
        declaredNames.length > 0 ? declaredNames.join(", ") : "none"
      }`,
      {
        code: "scenario_parameter_unknown",
        httpStatus: 422,
        meta: { unknownKeys, declaredNames },
      },
    );
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

  constructor({
    names,
    field,
  }: {
    names: string[];
    field: ScenarioContentField;
  }) {
    super(
      `No value for scenario parameters referenced in ${field}: ${names.join(", ")}`,
      {
        code: "scenario_parameter_missing",
        httpStatus: 422,
        meta: { names, field },
      },
    );
    this.name = "ScenarioParameterMissingError";
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
    super(`Scenario ${field} could not be rendered`, {
      code: "scenario_parameter_template_invalid",
      httpStatus: 422,
      meta: { field },
    });
    this.name = "ScenarioParameterTemplateInvalidError";
  }
}
