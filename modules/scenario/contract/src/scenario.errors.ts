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

/**
 * Refuses a run addressed to a set the platform owns.
 *
 * The internal namespace holds two kinds of address. `__internal__<suiteId>__
 * suite` is a run plan's, and every read of that plan aggregates the runs
 * stored there, so a one-off run written into it moves that plan's pass rate,
 * cost and trend. `__internal__<projectId>__on-platform-scenarios` is the
 * one-off bucket, and only the project's own.
 *
 * A set name outside the namespace is the customer's own and stays free.
 *
 * Tenancy is enforced elsewhere. This refusal is about not corrupting a plan
 * the caller is otherwise entitled to read.
 *
 * @see specs/scenarios/reserved-set-write-guard.feature
 */
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
