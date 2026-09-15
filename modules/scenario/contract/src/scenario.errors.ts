import { HandledError, NotFoundError, remediation } from "@langwatch/handled-error";

export class ScenarioNotFoundError extends HandledError {
  declare readonly code: "scenario_not_found";

  constructor(readonly scenarioId: string) {
    super("scenario_not_found", `Scenario ${scenarioId} was not found.`, {
      httpStatus: 404,
      fault: "customer",
      meta: { scenarioId },
    });
    this.name = "ScenarioNotFoundError";
  }
}

export class ScenarioTestSuiteNotFoundError extends HandledError {
  declare readonly code: "scenario_test_suite_not_found";

  constructor(testSuiteId?: string) {
    super("scenario_test_suite_not_found", "Test suite not found", {
      httpStatus: 404,
      fault: "customer",
      meta: { testSuiteId: testSuiteId ?? null },
    });
    this.name = "ScenarioTestSuiteNotFoundError";
  }
}

export class ScenarioTestSuiteSlugUnavailableError extends HandledError {
  declare readonly code: "scenario_folder_slug_unavailable";

  constructor(testSuiteName: string) {
    super("scenario_folder_slug_unavailable", "Could not allocate a unique test suite slug.", {
      httpStatus: 409,
      fault: "customer",
      meta: { testSuiteName },
    });
    this.name = "ScenarioTestSuiteSlugUnavailableError";
  }
}

export class ScenarioStaleVersionError extends HandledError {
  declare readonly code: "scenario_stale_version";

  constructor(currentVersion: number) {
    super("scenario_stale_version", "This test case changed since it was loaded", {
      httpStatus: 409,
      fault: "customer",
      meta: { currentVersion },
    });
    this.name = "ScenarioStaleVersionError";
  }
}

export class ScenarioVersionNotFoundError extends NotFoundError {
  declare readonly code: "scenario_version_not_found";

  constructor(scenarioId: string, version: number) {
    super("scenario_version_not_found", "Scenario version", String(version), {
      meta: { scenarioId, version },
    });
    this.name = "ScenarioVersionNotFoundError";
  }
}

// Refuses runs to internal platform-owned sets to avoid corrupting plan aggregates.
// See specs/scenarios/reserved-set-write-guard.feature
export class ScenarioReservedSetIdError extends HandledError {
  declare readonly code: "scenario_reserved_set_id";

  constructor() {
    super("scenario_reserved_set_id", "This run cannot be recorded under a reserved set", {
      httpStatus: 400,
      fault: "customer",
      ...remediation("scenario_reserved_set_id"),
    });
    this.name = "ScenarioReservedSetIdError";
  }
}

/**
 * Why a run was refused before anything was queued. Both reasons are the
 * caller's to fix - an unknown scenario, an unsatisfiable parameter, a target
 * the prefetch could not validate - so this answers at the status the
 * surface has always answered them with rather than degrading to an unknown
 * failure.
 */
export class ScenarioRunRejectedError extends HandledError {
  declare readonly code: "scenario_run_rejected";

  constructor(message: string, options: { reasons?: readonly Error[] } = {}) {
    super("scenario_run_rejected", message, {
      httpStatus: 400,
      fault: "customer",
      ...(options.reasons ? { reasons: options.reasons } : {}),
    });
    this.name = "ScenarioRunRejectedError";
  }
}

// Thrown when a scenario has a field value the test suite doesn't declare.
// Lists on meta so editor shows refused vs. declared names for typo visibility.
export class ScenarioFieldUnknownError extends HandledError {
  declare readonly code: "scenario_field_unknown";

  constructor({ identifiers, declared }: { identifiers: string[]; declared: string[] }) {
    super(
      "scenario_field_unknown",
      `Unknown scenario fields: ${identifiers.join(", ")}. Declared: ${
        declared.length > 0 ? declared.join(", ") : "none"
      }`,
      {
        httpStatus: 422,
        fault: "customer",
        meta: { identifiers, declared },
      },
    );
    this.name = "ScenarioFieldUnknownError";
  }
}

/**
 * Thrown when a scenario field value cannot be read as the type the test suite
 * declares for it: text where a number was declared, a word that is neither
 * true nor false for a boolean.
 *
 * @see specs/scenarios/scenario-fields.feature
 */
export class ScenarioFieldTypeInvalidError extends HandledError {
  declare readonly code: "scenario_field_type_invalid";

  constructor({ identifier, type }: { identifier: string; type: string }) {
    super(
      "scenario_field_type_invalid",
      `The value of ${identifier} cannot be read as ${type}`,
      {
        httpStatus: 422,
        fault: "customer",
        meta: { identifier, type },
      },
    );
    this.name = "ScenarioFieldTypeInvalidError";
  }
}

/**
 * Error when ClickHouse-backed simulation reads are not composed yet,
 * refusing raw crash with undefined.
 */
export class ScenarioSimulationsUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super(
      "service_unavailable",
      "This deployment cannot read simulation runs yet, because its simulation reads are not composed.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "ScenarioSimulationsUnavailableError";
  }
}

/** Refuses decryption without the deployment key before a provider receives invalid credentials. */
export class ScenarioSecretsUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super(
      "service_unavailable",
      "This deployment cannot store or read scenario secrets, because it has no encryption key configured.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "ScenarioSecretsUnavailableError";
  }
}

/**
 * The agent row a finish names does not exist in the project. The row id comes
 * from the signed token, but it is still checked against the project before a
 * run is written under it, so a stale or forged row id cannot create a run.
 */
export class VoiceAgentNotFoundError extends HandledError {
  declare readonly code: "agent_not_found";
  constructor() {
    super("agent_not_found", "The voice agent was not found in this project", {
      httpStatus: 404,
    });
    this.name = "VoiceAgentNotFoundError";
  }
}
