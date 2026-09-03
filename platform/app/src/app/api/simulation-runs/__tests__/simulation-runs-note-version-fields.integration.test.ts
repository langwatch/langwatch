/**
 * The REST simulation-run responses publish the run note and the scenario
 * version as fields of their own, mapped one by one off the stored metadata.
 * The metadata object itself stays out of the responses: its layout is
 * internal, the fields are the contract.
 *
 * @see specs/scenarios/scenario-version-on-runs.feature
 * @see specs/suites/run-notes.feature
 */

import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { NullSimulationRepository } from "~/server/app-layer/simulations/repositories/simulation.repository";
import { SimulationRunService } from "~/server/app-layer/simulations/simulation-run.service";
import { prisma } from "~/server/db";
import { ScenarioRunExportService } from "~/server/export/scenario-runs/scenario-run-export.service";
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

const stampedRun = makeRun({
  metadata: {
    note: "nightly regression",
    langwatch: {
      targetReferenceId: "agent_1",
      targetType: "http",
      scenarioVersion: 4,
    },
  },
});

describe("Feature: run responses carry the note and the scenario version", () => {
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

  class StubSimulationRepository extends NullSimulationRepository {
    constructor(private readonly run: ScenarioRunData) {
      super();
    }

    override async getScenarioRunData() {
      return this.run;
    }

    override async getRunDataForBatchRun() {
      return {
        changed: true as const,
        lastUpdatedAt: Date.now(),
        runs: [this.run],
      };
    }
  }

  function withRun(run: ScenarioRunData) {
    const repository = new StubSimulationRepository(run);
    globalForApp.__langwatch_app = createTestApp({
      simulations: {
        runs: new SimulationRunService(repository),
        export: ScenarioRunExportService.create(repository),
      },
    });
    return repository;
  }

  const get = (path: string) =>
    app.request(path, { headers: { "X-Auth-Token": testApiKey } });

  describe("the single-run response", () => {
    it("flattens the note and the scenario version and drops the raw metadata", async () => {
      withRun(stampedRun);

      const res = await get("/api/simulation-runs/run_1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;

      expect(body.note).toBe("nightly regression");
      expect(body.scenarioVersion).toBe(4);
      expect(body).not.toHaveProperty("metadata");
    });

    it("serves null fields for a run recorded before notes and versions existed", async () => {
      withRun(makeRun());

      const res = await get("/api/simulation-runs/run_1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;

      expect(body.note).toBeNull();
      expect(body.scenarioVersion).toBeNull();
    });
  });

  describe("the run list response", () => {
    it("flattens the same fields on every listed run", async () => {
      withRun(stampedRun);

      const res = await get("/api/simulation-runs?batchRunId=batch_1");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        runs: Array<Record<string, unknown>>;
      };

      expect(body.runs[0]?.note).toBe("nightly regression");
      expect(body.runs[0]?.scenarioVersion).toBe(4);
      expect(body.runs[0]).not.toHaveProperty("metadata");
    });
  });
});
