/**
 * Custom error types for scenario domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */

import {
  HandledError,
  type HandledErrorOptions,
  NotFoundError,
} from "@langwatch/handled-error";

import type { AppErrorCode } from "~/features/errors/logic/codes";
import { remediation } from "~/server/app-layer/error-remediation";
import type { ScenarioContentField } from "./execution/scenario-content-template";

export class ScenarioNotFoundError extends Error {
  constructor(message = "Scenario not found") {
    super(message);
    this.name = "ScenarioNotFoundError";
  }
}

/**
 * Thrown when a scenario is filed into something that is not an active folder
 * of the same project: a custom run plan, an archived folder, another
 * project's folder, or an id that names nothing.
 */
export class ScenarioFolderNotFoundError extends HandledError {
  declare readonly code: "scenario_folder_not_found";

  constructor() {
    super("scenario_folder_not_found", "Test suite folder not found", {
      httpStatus: 404,
    });
    this.name = "ScenarioFolderNotFoundError";
  }
}

/**
 * Refuses a save made against a version somebody else already replaced.
 *
 * Raised only when the caller sent an expected version: a caller that sends
 * none asked for "save over whatever is there", and gets the next number. The
 * refusal happens before the write, so the stored case is exactly as the other
 * save left it. `currentVersion` rides on `meta` so the editor can offer the
 * reload it needs.
 *
 * @see specs/scenarios/scenario-versioning.feature
 */
export class ScenarioStaleVersionError extends HandledError {
  declare readonly code: "scenario_stale_version";

  constructor({ currentVersion }: { currentVersion: number }) {
    super(
      "scenario_stale_version",
      "This test case changed since it was loaded",
      {
        httpStatus: 409,
        fault: "customer",
        meta: { currentVersion },
      },
    );
    this.name = "ScenarioStaleVersionError";
  }
}

/**
 * Raised when a version number names no stored version of the scenario.
 *
 * The synthesized "Created" entry a pre-versioning scenario shows also lands
 * here on read or restore: it has no stored snapshot to serve.
 *
 * @see specs/scenarios/scenario-version-restore.feature
 */
export class ScenarioVersionNotFoundError extends NotFoundError {
  declare readonly code: "scenario_version_not_found";

  constructor({
    scenarioId,
    version,
  }: {
    scenarioId: string;
    version: number;
  }) {
    super("scenario_version_not_found", "Scenario version", String(version), {
      meta: { scenarioId, version },
    });
    this.name = "ScenarioVersionNotFoundError";
  }
}

/**
 * A run's target agent points at a `langwatch agent dev` tunnel that no
 * longer answers: the developer's session ended without restoring the URL.
 *
 * `fault` is explicit despite the 5xx: the dead tunnel is on the customer's
 * machine, so this is an expected, customer-fixable state, not an incident on
 * our side. The scenario failure handler projects this error into the run's
 * stored error envelope so the drawer names the failure instead of showing a
 * generic connection error.
 */
export class AgentDevTunnelUnreachableError extends HandledError {
  declare readonly code: "agent_dev_tunnel_unreachable";

  constructor() {
    super(
      "agent_dev_tunnel_unreachable",
      "The agent points at a local development tunnel that is no longer " +
        "responding. The `langwatch agent dev` session that created it has " +
        "probably ended.",
      {
        httpStatus: 502,
        fault: "customer",
        ...remediation("agent_dev_tunnel_unreachable"),
      },
    );
    this.name = "AgentDevTunnelUnreachableError";
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
  constructor({
    message,
    code,
    httpStatus,
    ...rest
  }: HandledErrorOptions & {
    message: string;
    code: AppErrorCode;
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

  constructor({
    names,
    field,
  }: {
    names: string[];
    field: ScenarioContentField;
  }) {
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

  constructor({
    names,
    field,
  }: {
    names: string[];
    field: ScenarioContentField;
  }) {
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
