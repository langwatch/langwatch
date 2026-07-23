/**
 * The simulation-runs REST API is the single source of truth for a scenario
 * run's platform address. Before this fix, every branch hardcoded the bare
 * `/simulations` index regardless of which run was returned — a card or a
 * navigate instruction built on that link always landed on the index, never
 * the run.
 *
 * @see specs/langy/langy-agent-driven-navigation.feature
 */
import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { SimulationRunService } from "~/server/app-layer/simulations/simulation-run.service";
import { NullSimulationRepository } from "~/server/app-layer/simulations/repositories/simulation.repository";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { prisma } from "~/server/db";
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

describe("Feature: simulation-runs platform link addresses the run", () => {
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

  class TestSimulationRepository extends NullSimulationRepository {
    constructor(private readonly run: ScenarioRunData | null) {
      super();
    }
    override async getScenarioRunData(): Promise<ScenarioRunData | null> {
      return this.run;
    }
  }

  function withRuns(over: { getScenarioRunData?: ScenarioRunData | null }) {
    globalForApp.__langwatch_app = createTestApp({
      simulations: {
        runs: new SimulationRunService(
          new TestSimulationRepository(over.getScenarioRunData ?? null),
        ),
      },
    });
  }

  const get = (path: string) =>
    app.request(path, { headers: { "X-Auth-Token": testApiKey } });

  // The link is BASE_HOST + the project-scoped path, and BASE_HOST is
  // deployment config (CI carries a scheme-less `localhost:3000`). What this
  // spec pins is the PATH the platform addresses, so assert on the tail of the
  // link rather than parsing it as a well-formed absolute URL — otherwise the
  // test measures the environment, not the behaviour.
  describe("When the platform computes the link for a specific scenario run", () => {
    /** @scenario "The platform link for a simulation run lands on that run" */
    it("lands on that run's detail view, not the simulations index page", async () => {
      withRuns({ getScenarioRunData: makeRun() });

      const res = await get("/api/simulation-runs/run_1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { platformUrl: string };

      expect(body.platformUrl).toContain(
        `/${testProject.slug}/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1`,
      );
      expect(body.platformUrl).not.toMatch(
        new RegExp(`/${testProject.slug}/simulations$`),
      );
    });
  });

  describe("When the run's scenario set cannot be resolved", () => {
    /** @scenario "Every run gets a precise address, even when its set is unknown" */
    it("still addresses the run's own drawer — never the simulations index", async () => {
      withRuns({
        getScenarioRunData: makeRun({ scenarioSetId: undefined }),
      });

      const res = await get("/api/simulation-runs/run_1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { platformUrl: string };

      expect(body.platformUrl).toContain(
        `/${testProject.slug}/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=run_1`,
      );
    });
  });
});
