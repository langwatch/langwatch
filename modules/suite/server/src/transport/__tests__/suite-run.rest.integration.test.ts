/**
 * @vitest-environment node
 * @see specs/scenarios/scenario-run-parameters.feature
 */
import {
  bindRestHeader,
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { suiteSchema, type SuiteApi, type SuiteRunResult } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { suiteSurfaceFact } from "../../rules/suite-wire-v1.rules.ts";
import { createSuitesAliasRest, suitesAliasErrorHandler } from "../suites-alias.rest.ts";

class ScenarioParameterUnknownTestError extends HandledError {
  constructor() {
    super(
      "scenario_parameter_unknown",
      "Unknown scenario parameters: seats. Declared: account_tier",
      { httpStatus: 422 },
    );
  }
}

const boundaryErrorHandler: RestErrorHandler = (error, c) => {
  const handled = error as Error & { code?: string; httpStatus?: number };
  if (typeof handled.code === "string" && typeof handled.httpStatus === "number") {
    return c.json({ error: handled.code, message: handled.message }, handled.httpStatus as 400);
  }

  return c.json({ error: "internal_server_error", message: String(error) }, 500);
};

const NOW = new Date("2026-01-01T00:00:00.000Z");

/** The stored plan the door reads before it runs anything. */
const storedPlan = suiteSchema.parse({
  id: "suite_1",
  projectId: "project-1",
  name: "Nightly",
  slug: "nightly",
  kind: "run_plan",
  description: null,
  scenarioIds: ["scenario_1"],
  scope: null,
  targets: [{ type: "http", referenceId: "agent_1" }],
  repeatCount: 1,
  labels: [],
  simulatorModel: null,
  judgeModel: null,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
});

function buildApi(run: (...args: never[]) => unknown) {
  // The door asks which kind the id names before it runs anything: a run plan
  // runs the targets it stores, a test suite takes them from the body.
  const suites = createApiFixture<SuiteApi>({
    run: run as SuiteApi["run"],
    getByIdOrTestSuite: async () => ({ kind: "suite", suite: storedPlan }),
  });
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project-1" } }),
    },
  });
  const app = runtime.mount(
    createSuitesAliasRest(({ projectSlug, path }) => `https://app.test/${projectSlug}${path}`)
      .router(),
    {
      app: () => suites,
      credential: "project",
      onError: suitesAliasErrorHandler(boundaryErrorHandler),
      facts: [
        bindRestMiddleware(projectRestFacts, () => ({
          projectSlug: "project-one",
          viewerUserId: null,
          actorId: "project-key-1",
        })),
        bindRestHeader(suiteSurfaceFact, "x-langwatch-surface"),
      ],
    },
  );

  return {
    fetch: (path: string, body: unknown) =>
      app.fetch(
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
  items: [],
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
