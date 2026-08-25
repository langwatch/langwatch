import { nanoid } from "nanoid";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type {
  Agent,
  Organization,
  Prisma,
  Project,
  Scenario,
  SimulationSuite,
  Team,
} from "~/generated/prisma/client";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import type { StartSuiteRunCommandData } from "~/server/event-sourcing/pipelines/suite-run-processing/schemas/commands";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import { app } from "../[[...route]]/app";

describe("Feature: Suites REST API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let startSuiteRun: Mock<(data: StartSuiteRunCommandData) => Promise<void>>;
  let queueSimulationRun: Mock<(data: QueueRunCommandData) => Promise<void>>;
  let helpers: {
    api: {
      get: (path: string) => Response | Promise<Response>;
      post: (path: string, body: unknown) => Response | Promise<Response>;
      patch: (path: string, body: unknown) => Response | Promise<Response>;
      delete: (path: string) => Response | Promise<Response>;
    };
  };

  const createAuthHeaders = (apiKey: string) => ({
    "X-Auth-Token": apiKey,
    "Content-Type": "application/json",
  });

  beforeEach(async () => {
    await resetApp();
    const mockGetActivePlan = vi.fn().mockResolvedValue(FREE_PLAN);
    startSuiteRun = vi.fn(async () => {});
    queueSimulationRun = vi.fn(async () => {});
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyPlanLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
      suiteCommands: { startSuiteRun, queueRun: queueSimulationRun },
    });

    testOrganization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `test-org-${nanoid()}`,
      },
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
        ...projectFactory.build({ slug: nanoid() }),
        teamId: testTeam.id,
        personalFeatures: {},
      },
    });

    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;

    helpers = {
      api: {
        get: (path: string) =>
          app.request(path, { headers: { "X-Auth-Token": testApiKey } }),
        post: (path: string, body: unknown) =>
          app.request(path, {
            method: "POST",
            headers: createAuthHeaders(testApiKey),
            body: JSON.stringify(body),
          }),
        patch: (path: string, body: unknown) =>
          app.request(path, {
            method: "PATCH",
            headers: createAuthHeaders(testApiKey),
            body: JSON.stringify(body),
          }),
        delete: (path: string) =>
          app.request(path, {
            method: "DELETE",
            headers: { "X-Auth-Token": testApiKey },
          }),
      },
    };
  });

  afterEach(async () => {
    await cleanupTestRows(prisma, [
      ["simulationSuite", { projectId: testProjectId }],
      ["scenario", { projectId: testProjectId }],
      ["agent", { projectId: testProjectId }],
    ]);
    await prisma.project.delete({
      where: { id: testProjectId },
    });
    await prisma.team.delete({
      where: { id: testTeam.id },
    });
    await prisma.organization.delete({
      where: { id: testOrganization.id },
    });
    await resetApp();
  });

  async function createScenario(
    name: string,
    overrides: Partial<{ situation: string; parameters: unknown }> = {},
  ): Promise<Scenario> {
    return prisma.scenario.create({
      data: {
        projectId: testProjectId,
        name,
        situation: overrides.situation ?? `Testing ${name}`,
        criteria: ["criterion_1"],
        labels: [],
        ...(overrides.parameters !== undefined && {
          parameters: overrides.parameters as Prisma.InputJsonValue,
        }),
      },
    });
  }

  async function createHttpAgent(): Promise<Agent> {
    return prisma.agent.create({
      data: {
        projectId: testProjectId,
        name: "Test Agent",
        type: "http",
        config: {
          url: "https://example.com/chat",
          method: "POST",
          headers: [],
          bodyTemplate: '{"message": "{{input}}"}',
        },
      },
    });
  }

  async function createSuite(
    overrides: Partial<{
      name: string;
      scenarioIds: string[];
      targets: unknown;
      archivedAt: Date | null;
    }> = {},
  ): Promise<SimulationSuite> {
    const scenario = await createScenario("Test Scenario");
    return prisma.simulationSuite.create({
      data: {
        id: `suite_${nanoid()}`,
        projectId: testProjectId,
        name: overrides.name ?? "Test Suite",
        slug: `test-suite-${nanoid()}`,
        scenarioIds: overrides.scenarioIds ?? [scenario.id],
        targets: overrides.targets ?? [
          { type: "http", referenceId: "agent_test" },
        ],
        repeatCount: 1,
        labels: [],
        archivedAt: overrides.archivedAt ?? null,
      },
    });
  }

  describe("Authentication", () => {
    it("returns 401 with invalid API key", async () => {
      const res = await app.request("/api/suites", {
        headers: { "X-Auth-Token": "invalid-key" },
      });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/suites", () => {
    describe("when no suites exist", () => {
      it("returns an empty array", async () => {
        const res = await helpers.api.get("/api/suites");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(0);
      });
    });

    describe("when suites exist", () => {
      it("returns all non-archived suites", async () => {
        const suite = await createSuite({ name: "My Suite" });

        const res = await helpers.api.get("/api/suites");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.length).toBe(1);
        expect(body[0].id).toBe(suite.id);
        expect(body[0].name).toBe("My Suite");
      });

      /** @scenario Archived suite does not appear in sidebar search results */
      it("excludes archived suites", async () => {
        await createSuite({ archivedAt: new Date() });

        const res = await helpers.api.get("/api/suites");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.length).toBe(0);
      });
    });
  });

  describe("GET /api/suites/:id", () => {
    describe("when suite exists", () => {
      it("returns the suite with all fields", async () => {
        const suite = await createSuite({ name: "Detail Suite" });

        const res = await helpers.api.get(`/api/suites/${suite.id}`);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
          id: suite.id,
          name: "Detail Suite",
          repeatCount: 1,
        });
        expect(body.scenarioIds).toHaveLength(1);
        expect(body.targets).toHaveLength(1);
      });
    });

    describe("when suite does not exist", () => {
      it("returns 404", async () => {
        const res = await helpers.api.get("/api/suites/nonexistent-id");

        expect(res.status).toBe(404);
      });
    });
  });

  describe("POST /api/suites", () => {
    it("creates a new suite", async () => {
      const scenario = await createScenario("Create Test Scenario");

      const res = await helpers.api.post("/api/suites", {
        name: "New Suite",
        scenarioIds: [scenario.id],
        targets: [{ type: "http", referenceId: "agent_abc" }],
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("New Suite");
      expect(body.slug).toBe("new-suite");
      expect(body.scenarioIds).toContain(scenario.id);
    });

    it("rejects duplicate names", async () => {
      const scenario = await createScenario("Dupe Scenario");
      // Create first suite via the API so the service assigns the canonical slug
      await helpers.api.post("/api/suites", {
        name: "Duplicate Name",
        scenarioIds: [scenario.id],
        targets: [{ type: "http", referenceId: "agent_abc" }],
      });

      const res = await helpers.api.post("/api/suites", {
        name: "Duplicate Name",
        scenarioIds: [scenario.id],
        targets: [{ type: "http", referenceId: "agent_abc" }],
      });

      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("suite_name_taken");
    });
  });

  describe("PATCH /api/suites/:id", () => {
    it("updates the suite name", async () => {
      const suite = await createSuite({ name: "Old Name" });

      const res = await helpers.api.patch(`/api/suites/${suite.id}`, {
        name: "New Name",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("New Name");
    });
  });

  describe("POST /api/suites/:id/duplicate", () => {
    it("creates a copy of the suite", async () => {
      const suite = await createSuite({ name: "Original" });

      const res = await helpers.api.post(
        `/api/suites/${suite.id}/duplicate`,
        {},
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("Original (copy)");
      expect(body.id).not.toBe(suite.id);
    });
  });

  describe("POST /api/suites/:id/run", () => {
    async function createRunnableSuite(
      scenarioOverrides: Partial<{
        situation: string;
        parameters: unknown;
      }> = {},
    ) {
      const scenario = await createScenario("Refund Flow", scenarioOverrides);
      const agent = await createHttpAgent();
      const suite = await prisma.simulationSuite.create({
        data: {
          id: `suite_${nanoid()}`,
          projectId: testProjectId,
          name: "Runnable Suite",
          slug: `runnable-suite-${nanoid()}`,
          scenarioIds: [scenario.id],
          targets: [{ type: "http", referenceId: agent.id }],
          repeatCount: 1,
          labels: [],
        },
      });
      return { scenario, agent, suite };
    }

    describe("when the run plan is valid", () => {
      /** @scenario "The suite run REST endpoint schedules jobs and returns the batch id" */
      it("schedules the jobs and returns the batch id", async () => {
        const { suite } = await createRunnableSuite();

        const res = await helpers.api.post(`/api/suites/${suite.id}/run`, {
          idempotencyKey: "run-key-1",
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({ scheduled: true, jobCount: 1 });
        expect(body.batchRunId).toEqual(expect.any(String));
        expect(startSuiteRun).toHaveBeenCalledWith(
          expect.objectContaining({
            batchRunId: body.batchRunId,
            idempotencyKey: "run-key-1",
            total: 1,
          }),
        );
        expect(queueSimulationRun).toHaveBeenCalledTimes(1);
      });

      /** @scenario "The suite run REST endpoint schedules jobs and returns the batch id" */
      it("records the resolved parameter values on the queued run", async () => {
        const { scenario, suite } = await createRunnableSuite({
          situation: "A {{ params.account_tier }} customer asks for a refund",
          parameters: [
            { name: "account_tier", defaultValue: "gold" },
            { name: "region", defaultValue: "eu-central" },
          ],
        });

        const res = await helpers.api.post(`/api/suites/${suite.id}/run`, {
          idempotencyKey: "run-key-2",
          parameters: { account_tier: "platinum" },
        });

        expect(res.status).toBe(200);
        expect(queueSimulationRun).toHaveBeenCalledWith(
          expect.objectContaining({
            scenarioId: scenario.id,
            metadata: expect.objectContaining({
              parameters: {
                account_tier: "platinum",
                region: "eu-central",
              },
            }),
          }),
        );
      });
    });

    describe("when a supplied name is declared by no scenario in the run", () => {
      /** @scenario "A run-time key no scenario in the run declares is rejected with scenario_parameter_unknown" */
      it("rejects the run with scenario_parameter_unknown", async () => {
        const { suite } = await createRunnableSuite({
          parameters: [
            { name: "account_tier", defaultValue: "gold" },
            { name: "region", defaultValue: "eu-central" },
          ],
        });

        const res = await helpers.api.post(`/api/suites/${suite.id}/run`, {
          idempotencyKey: "run-key-3",
          parameters: { regoin: "eu-west" },
        });

        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBe("scenario_parameter_unknown");
        expect(body.unknownKeys).toEqual(["regoin"]);
        expect(body.declaredNames).toEqual(
          expect.arrayContaining(["account_tier", "region"]),
        );
      });

      /** @scenario "A run-time key no scenario in the run declares is rejected with scenario_parameter_unknown" */
      it("schedules nothing", async () => {
        const { suite } = await createRunnableSuite({
          parameters: [{ name: "account_tier", defaultValue: "gold" }],
        });

        await helpers.api.post(`/api/suites/${suite.id}/run`, {
          idempotencyKey: "run-key-4",
          parameters: { regoin: "eu-west" },
        });

        expect(startSuiteRun).not.toHaveBeenCalled();
        expect(queueSimulationRun).not.toHaveBeenCalled();
      });
    });
  });

  describe("DELETE /api/suites/:id", () => {
    /** @scenario Archived suite is hidden from the active list */
    it("archives the suite", async () => {
      const suite = await createSuite({ name: "To Archive" });

      const res = await helpers.api.delete(`/api/suites/${suite.id}`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ id: suite.id, archived: true });
    });

    it("excludes the archived suite from list results", async () => {
      const suite = await createSuite({ name: "Will Archive" });
      await helpers.api.delete(`/api/suites/${suite.id}`);

      const listRes = await helpers.api.get("/api/suites");

      expect(listRes.status).toBe(200);
      const body = await listRes.json();
      const ids = body.map((s: { id: string }) => s.id);
      expect(ids).not.toContain(suite.id);
    });

    /** @scenario Archiving a non-existent suite returns not found */
    it("returns 404 for non-existent suite", async () => {
      const res = await helpers.api.delete("/api/suites/nonexistent-id");

      expect(res.status).toBe(404);
    });
  });
});
