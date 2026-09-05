/**
 * GET /api/simulation-runs/batches/:batchRunId serves one batch as a resource of its own, so a CI
 * job polls the batch id it was handed at scheduling time.
 * @see specs/features/simulation-runs-batch-completion.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { SimulationService } from "#services/simulation.service";
import { createSimulationRunsRestApp } from "../simulation-run.api";

const project = {
  id: "project-123",
  name: "Project 123",
  slug: "project-123",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};

const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    c.set("project", project);
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
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

function makeSummary(overrides: Record<string, unknown> = {}) {
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

function mount(tryGetBatchSummary: ReturnType<typeof vi.fn>) {
  const app = createSimulationRunsRestApp({
    security: testSecurity(),
    simulations: () => ({ tryGetBatchSummary }) as unknown as SimulationService,
    scenarioRunPlatformUrl: () => "https://app.test/run",
  });

  return {
    tryGetBatchSummary,
    fetch: (path: string) => app.hono.fetch(new Request(`http://api.test${path}`)),
  };
}

describe("given the simulation runs REST family", () => {
  describe("when a batch is requested by its batch run id", () => {
    /** @scenario "A batch summary is addressable by its batch run id" */
    it("serves the batch counts and an isComplete flag", async () => {
      const api = mount(vi.fn(async () => makeSummary()));

      const response = await api.fetch("/api/simulation-runs/batches/batch_1");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        batchRunId: "batch_1",
        totalCount: 2,
        settledCount: 1,
        runningCount: 1,
        isComplete: false,
      });
      expect(api.tryGetBatchSummary).toHaveBeenCalledWith({
        projectId: project.id,
        batchRunId: "batch_1",
      });
    });

    it("reports a batch whose runs all settled as complete", async () => {
      const api = mount(
        vi.fn(async () => makeSummary({ runningCount: 0, settledCount: 2, allCompletedAt: 2000 })),
      );

      const response = await api.fetch("/api/simulation-runs/batches/batch_1");

      await expect(response.json()).resolves.toMatchObject({ isComplete: true });
    });
  });

  describe("when the project holds no run for the batch id", () => {
    /** @scenario "An unknown batch run id answers 404" */
    it("answers 404", async () => {
      const api = mount(vi.fn(async () => null));

      const response = await api.fetch("/api/simulation-runs/batches/missing_batch");

      expect(response.status).toBe(404);
    });
  });
});
