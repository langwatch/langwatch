/**
 * @vitest-environment node
 *
 * `POST /api/suites/:id/run`, driven through the real Hono app: it schedules
 * jobs through SuiteApp.run and answers with the batch id, and it lets a
 * parameter-validation refusal (an unknown run-time key, a secret override)
 * surface as the boundary error it is rather than a bare 500.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { SuiteRunResult } from "@langwatch/suite-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { SuiteApp } from "#app/suite.app";
import { createSuiteRestApp } from "../suite.api";

class ScenarioParameterUnknownTestError extends HandledError {
  constructor() {
    super(
      "scenario_parameter_unknown",
      "Unknown scenario parameters: seats. Declared: account_tier",
      { httpStatus: 422 },
    );
  }
}

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  const handled = error as Error & { code?: string; httpStatus?: number };
  if (typeof handled.code === "string" && typeof handled.httpStatus === "number") {
    return c.json({ error: handled.code, message: handled.message }, handled.httpStatus as 400);
  }
  return c.json({ error: "internal_server_error", message: String(error) }, 500);
};

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    c.set("project", {
      id: "project-1",
      name: "Project One",
      slug: "project-one",
      teamId: "team-1",
      organizationId: "organization-1",
      isPersonal: false,
      ownerUserId: null,
    });
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };

  return createAppRestSecurity(ports);
}

function buildApi(run: (...args: never[]) => unknown) {
  // The door asks which kind the id names before it runs anything: a run plan
  // runs the targets it stores, a test suite takes them from the body.
  const suites = {
    run,
    getByIdOrTestSuite: async () => ({ kind: "suite", suite: { kind: "run_plan" } }),
  } as unknown as SuiteApp;
  const app = createSuiteRestApp({
    security: testSecurity(),
    suites: () => suites,
    platformUrl: () => "https://app.test/x",
  });

  return {
    fetch: (path: string, body: unknown) =>
      app.hono.fetch(
        new Request(`http://api.test${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
  };
}

const runResult: SuiteRunResult = {
  batchRunId: "batch_1",
  setId: "set_1",
  jobCount: 3,
  skippedArchived: { scenarios: [], targets: [] },
};

describe("POST /api/suites/:id/run", () => {
  describe("when the run schedules successfully", () => {
    /** @scenario "The suite run REST endpoint schedules jobs and returns the batch id" */
    it("returns the batch id and job count", async () => {
      const run = vi.fn().mockResolvedValue(runResult);
      const api = buildApi(run);

      const response = await api.fetch("/api/suites/suite_1/run", {
        idempotencyKey: "request_1",
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ scheduled: true, batchRunId: "batch_1", jobCount: 3 });
    });
  });

  describe("when a run-time parameter key no scenario in the run declares", () => {
    /** @scenario "A run-time key no scenario in the run declares is rejected with scenario_parameter_unknown" */
    it("refuses with scenario_parameter_unknown", async () => {
      const run = vi.fn().mockRejectedValue(new ScenarioParameterUnknownTestError());
      const api = buildApi(run);

      const response = await api.fetch("/api/suites/suite_1/run", {
        idempotencyKey: "request_1",
        parameters: { seats: 12 },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: "scenario_parameter_unknown" });
    });
  });
});
