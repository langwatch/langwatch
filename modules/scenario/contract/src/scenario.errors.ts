import { HandledError, NotFoundError, remediation } from "@langwatch/handled-error";

/**
 * The author-assist answered this project one generation too many inside the
 * window. `fault` stays customer: it is their generation rate, and the
 * retry-after is theirs to wait out.
 */
export class ScenarioGenerateRateLimitedError extends HandledError {
  declare readonly code: "scenario_generate_rate_limited";

  constructor(input: { retryAfterSeconds?: number | undefined }) {
    super("scenario_generate_rate_limited", "Too many scenario generations for this project", {
      httpStatus: 429,
      retryable: true,
      fault: "customer",
      ...(input.retryAfterSeconds !== undefined
        ? { meta: { retryAfterSeconds: input.retryAfterSeconds } }
        : {}),
    });
    this.name = "ScenarioGenerateRateLimitedError";
  }
}

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

/**
 * Reserved-set runs are refused to protect plan aggregates; see
 * specs/scenarios/reserved-set-write-guard.feature. This error preserves the
 * known 404 instead of a generic 500 (apidiff run 20260916-r6).
 */
export class SimulationRunNotFoundError extends NotFoundError {
  declare readonly code: "simulation_run_not_found";

  constructor(scenarioRunId: string) {
    super("simulation_run_not_found", "Simulation run", scenarioRunId, {
      meta: { scenarioRunId },
    });
    this.name = "SimulationRunNotFoundError";
  }
}

export class ScenarioTargetNotFoundError extends NotFoundError {
  declare readonly code: "scenario_target_not_found";

  constructor(input: { targetType: string; referenceId: string }) {
    super("scenario_target_not_found", "Scenario target", input.referenceId, {
      meta: { targetType: input.targetType, referenceId: input.referenceId },
    });
    this.name = "ScenarioTargetNotFoundError";
  }
}

/** A peer call omitted the archive scope the REST schema makes mandatory. */
export class ScenarioEventArchiveScopeError extends HandledError {
  declare readonly code: "scenario_event_archive_scope_invalid";

  constructor() {
    super(
      "scenario_event_archive_scope_invalid",
      "A scenario-event archive requires a run or set scope",
      {
        httpStatus: 400,
        fault: "customer",
      },
    );
    this.name = "ScenarioEventArchiveScopeError";
  }
}

/** The batch a set of simulation runs was started as, which this project does not hold. */
export class BatchRunNotFoundError extends NotFoundError {
  declare readonly code: "batch_run_not_found";

  constructor(batchRunId: string) {
    super("batch_run_not_found", "Batch run", batchRunId, { meta: { batchRunId } });
    this.name = "BatchRunNotFoundError";
  }
}

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
 * Why a run was refused before anything was queued: an unknown scenario, an
 * unsatisfiable parameter, or a target the prefetch could not validate —
 * all the caller's to fix, answered at the status the surface always used.
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
 * Thrown when a scenario field value cannot be read as its declared type:
 * text where a number was declared, neither true nor false for a boolean.
 * @see specs/scenarios/scenario-fields.feature
 */
export class ScenarioFieldTypeInvalidError extends HandledError {
  declare readonly code: "scenario_field_type_invalid";

  constructor({ identifier, type }: { identifier: string; type: string }) {
    super("scenario_field_type_invalid", `The value of ${identifier} cannot be read as ${type}`, {
      httpStatus: 422,
      fault: "customer",
      meta: { identifier, type },
    });
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

export class ScenarioGenerationFailedError extends HandledError {
  constructor(cause: unknown) {
    super("scenario_generation_failed", "Failed to generate scenario", {
      httpStatus: 500,
      fault: "platform",
      ...(cause instanceof Error ? { reasons: [cause] } : {}),
    });
  }
}

export class ScenarioGenerationTimedOutError extends HandledError {
  constructor() {
    super("scenario_generation_timed_out", "Scenario generation took too long and was stopped.", {
      httpStatus: 504,
      retryable: true,
      fault: "platform",
    });
  }
}

/**
 * A simulation write reached a process that composed only the reads: the
 * execution side belongs to the worker that drains the pipeline. Named
 * rather than a bare crash, so the caller is told which half is missing.
 */
export class ScenarioSimulationWritesUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super(
      "service_unavailable",
      `This deployment cannot ${capability}, because it composes simulation reads only.`,
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "ScenarioSimulationWritesUnavailableError";
  }
}
