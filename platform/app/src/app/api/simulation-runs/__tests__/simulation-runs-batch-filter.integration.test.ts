/**
 * GET /api/simulation-runs?batchRunId= must filter by the batch id on its
 * own. The route used to require scenarioSetId alongside it and silently fell
 * through to the unfiltered project listing otherwise, which is what made the
 * CLI's --wait count stale runs from old batches and time out.
 *
 * @see specs/features/simulation-runs-batch-filter.feature
 */

import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appContextBindingsFor } from "~/app/api/middleware/app-context";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { app } from "../[[...route]]/app";

function makeRun(overrides: Partial<ScenarioRunData> = {}): ScenarioRunData {
  return {
    scenarioId: "scenario_1",
    batchRunId: "batch_1",
    scenarioRunId: "run_1",
    scenarioSetId: "set_1",
    name: "Login flow",
    description: null,
    status: ScenarioRunStatus.SUCCESS,
    results: null,
    messages: [],
    timestamp: Date.now(),
    updatedAt: Date.now(),
    durationInMs: 1200,
    ...overrides,
  };
}

describe("Feature: simulation runs list filters by batch id alone", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;

  beforeEach(async () => {
    await resetApp();

    testOrganization = await prisma.organization.create({
      data: { name: "Test Organization", slug: `test-org-${nanoid()}` },
    });
    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });
    testProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `demo-${nanoid()}` }),
        teamId: testTeam.id,
        personalFeatures: {},
      },
    });
    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;
  });

  afterEach(async () => {
    if (!testProjectId) return;
    await prisma.project.delete({ where: { id: testProjectId } });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({ where: { id: testOrganization.id } });
  });

  /**
   * Records which repository method the route reached and with which params.
   * The batch method serves only the batch's runs; the all-suites method
   * serves the whole project, which is the fall-through the fix removes.
   */
  function withRepository() {
    const testApp = createTestApp();
    const batchCalls: Array<{
      projectId: string;
      scenarioSetId?: string;
      batchRunId: string;
    }> = [];
    let allSuitesCalls = 0;
    vi.spyOn(testApp.simulations, "getRunDataForBatchRun").mockImplementation(
      async (params) => {
        batchCalls.push(params);
        return {
          changed: true as const,
          lastUpdatedAt: Date.now(),
          runs: [makeRun({ batchRunId: params.batchRunId })],
        };
      },
    );
    vi.spyOn(testApp.simulations, "getRunDataForAllSuites").mockImplementation(
      async () => {
        allSuitesCalls += 1;
        return {
          changed: true as const,
          lastUpdatedAt: Date.now(),
          runs: [
            makeRun({ batchRunId: "batch_1" }),
            makeRun({
              batchRunId: "batch_stale",
              scenarioRunId: "run_stale",
              status: ScenarioRunStatus.IN_PROGRESS,
            }),
          ],
          scenarioSetIds: {},
          hasMore: false,
        };
      },
    );
    globalForApp.__langwatch_app = testApp;
    return {
      batchCalls,
      get allSuitesCalls() {
        return allSuitesCalls;
      },
    };
  }

  const get = (path: string) =>
    app.request(
      path,
      { headers: { "X-Auth-Token": testApiKey } },
      appContextBindingsFor(globalForApp.__langwatch_app!),
    );

  describe("when the list is requested with only a batchRunId", () => {
    /** @scenario "A batch id alone filters the list" */
    it("serves the batch's runs, never the whole project", async () => {
      const repository = withRepository();

      const res = await get("/api/simulation-runs?batchRunId=batch_1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        runs: Array<{ batchRunId: string }>;
      };

      expect(repository.allSuitesCalls).toBe(0);
      expect(repository.batchCalls).toEqual([
        {
          projectId: testProjectId,
          scenarioSetId: undefined,
          batchRunId: "batch_1",
        },
      ]);
      expect(body.runs.map((r) => r.batchRunId)).toEqual(["batch_1"]);
    });
  });

  describe("when the list is requested with both batchRunId and scenarioSetId", () => {
    /** @scenario "A batch id with a scenario set id keeps working" */
    it("passes both filters through to the batch query", async () => {
      const repository = withRepository();

      const res = await get(
        "/api/simulation-runs?batchRunId=batch_1&scenarioSetId=set_1",
      );
      expect(res.status).toBe(200);

      expect(repository.batchCalls).toEqual([
        {
          projectId: testProjectId,
          scenarioSetId: "set_1",
          batchRunId: "batch_1",
        },
      ]);
    });
  });
});
