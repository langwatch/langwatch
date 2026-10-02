/**
 * @vitest-environment node
 * @see specs/scenarios/scenario-run-parameters.feature
 */
import {
  bindRestHeader,
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  canonicalErrorResponse,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { suiteSchema, type SuiteApi, type SuiteRunResult } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { suiteCallerKeyFact, suiteSurfaceFact } from "../../rules/suite-wire-v1.rules.ts";
import { createSuitesAliasRest } from "../suites-alias.rest.ts";

class ScenarioParameterUnknownTestError extends HandledError {
  constructor() {
    super(
      "scenario_parameter_unknown",
      "Unknown scenario parameters: seats. Declared: account_tier",
      { httpStatus: 422 },
    );
  }
}

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
  const app = runtime.mount(createSuitesAliasRest().router(), {
    app: () => suites,
    credential: "project",
    onError: canonicalErrorResponse,
    facts: [
      bindRestMiddleware(projectRestFacts, () => ({
        projectSlug: "project-one",
        viewerUserId: null,
        actorId: "project-key-1",
      })),
      bindRestHeader(suiteSurfaceFact, "x-langwatch-surface"),
      bindRestMiddleware(suiteCallerKeyFact, () => null),
    ],
  });

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
      expect(await response.json()).toMatchObject({ code: "scenario_parameter_unknown" });
    });
  });

  describe("when the id names a run plan and the body carries execution settings", () => {
    it("refuses with validation_error and runs nothing", async () => {
      const run = vi.fn().mockResolvedValue(runResult);
      const api = buildApi(run);

      const response = await api.fetch("/api/suites/suite_1/run", {
        repeatCount: 2,
        judgeModel: "openai/gpt-5",
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "validation_error" });
      expect(run).not.toHaveBeenCalled();
    });
  });
});
