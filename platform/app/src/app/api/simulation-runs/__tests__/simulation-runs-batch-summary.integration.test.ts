/**
 * GET /api/simulation-runs/batches/:batchRunId serves one batch as a resource
 * of its own, so a CI job polls the batch id it was handed at scheduling time.
 * The response carries isComplete, derived from the settled and total counts.
 *
 * @see specs/features/simulation-runs-batch-completion.feature
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
import type { BatchSummary } from "~/server/scenarios/scenario-event.types";
import { app } from "../[[...route]]/app";

function makeSummary(overrides: Partial<BatchSummary> = {}): BatchSummary {
  return {
    batchRunId: "batch_1",
    totalCount: 2,
    passCount: 1,
    failCount: 0,
    runningCount: 1,
    settledCount: 1,
    stalledCount: 0,
    lastRunAt: 1000,
    lastUpdatedAt: 2000,
    firstCompletedAt: 1500,
    allCompletedAt: null,
    note: null,
    startedBy: null,
    ...overrides,
  };
}

describe("Feature: a batch of simulation runs reports when it is complete", () => {
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

  /** Serves one prepared summary and records how the route addressed it. */
  class RecordingSimulationRepository extends NullSimulationRepository {
    summaryCalls: Array<{ projectId: string; batchRunId: string }> = [];

    constructor(private readonly summary: BatchSummary | null) {
      super();
    }

    // The base class declares the method parameterless, so the override's
    // parameter must be optional to stay assignable; the route always passes
    // it.
    override async getBatchSummary(params?: {
      projectId: string;
      batchRunId: string;
    }) {
      if (!params) throw new Error("expected params");
      this.summaryCalls.push(params);
      return this.summary;
    }
  }

  function withSummary(summary: BatchSummary | null) {
    const repository = new RecordingSimulationRepository(summary);
    globalForApp.__langwatch_app = createTestApp({
      simulations: {
        runs: new SimulationRunService(repository),
        export: ScenarioRunExportService.create(repository),
      },
    });
    return repository;
  }

  const get = ({
    path,
    headers = {},
  }: {
    path: string;
    headers?: Record<string, string>;
  }) => app.request(path, { headers });

  const getAuthenticated = (path: string) =>
    get({ path, headers: { "X-Auth-Token": testApiKey } });

  describe("when the batch still holds a queued run", () => {
    /** @scenario "A batch summary is addressable by its batch run id" */
    /** @scenario "A batch with queued runs is not complete" */
    it("serves the counts of that batch and reports it as not complete", async () => {
      const repository = withSummary(makeSummary());

      const res = await getAuthenticated(
        "/api/simulation-runs/batches/batch_1",
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        batchRunId: string;
        settledCount: number;
        isComplete: boolean;
      };

      expect(repository.summaryCalls).toEqual([
        { projectId: testProjectId, batchRunId: "batch_1" },
      ]);
      expect(body.batchRunId).toBe("batch_1");
      expect(body.settledCount).toBe(1);
      expect(body.isComplete).toBe(false);
    });
  });

  describe("when every run of the batch reached a terminal status", () => {
    /** @scenario "A batch is complete when every run is terminal" */
    it("reports the batch as complete", async () => {
      withSummary(
        makeSummary({ settledCount: 2, runningCount: 0, allCompletedAt: 2000 }),
      );

      const res = await getAuthenticated(
        "/api/simulation-runs/batches/batch_1",
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { isComplete: boolean };

      expect(body.isComplete).toBe(true);
    });
  });

  describe("when the batch was run with a note", () => {
    it("serves the note as a field of its own", async () => {
      withSummary(makeSummary({ note: "nightly regression" }));

      const res = await getAuthenticated(
        "/api/simulation-runs/batches/batch_1",
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { note: string | null };

      expect(body.note).toBe("nightly regression");
    });

    it("serves null for a batch run without one", async () => {
      withSummary(makeSummary());

      const res = await getAuthenticated(
        "/api/simulation-runs/batches/batch_1",
      );
      const body = (await res.json()) as { note: string | null };

      expect(body.note).toBeNull();
    });
  });

  describe("when the project holds no run for the batch id", () => {
    /** @scenario "An unknown batch run id answers 404" */
    it("answers 404", async () => {
      withSummary(null);

      const res = await getAuthenticated(
        "/api/simulation-runs/batches/batch_unknown",
      );

      expect(res.status).toBe(404);
    });
  });

  describe("when the request carries no api key", () => {
    it("answers 401", async () => {
      withSummary(makeSummary());

      const res = await get({ path: "/api/simulation-runs/batches/batch_1" });

      expect(res.status).toBe(401);
    });
  });
});
