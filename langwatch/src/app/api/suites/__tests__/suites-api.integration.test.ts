import type { Organization, Project, Scenario, SimulationSuite, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  PlanProviderService,
  type PlanProvider,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { app } from "../[[...route]]/app";

describe("Feature: Suites REST API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
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
    resetApp();
    const mockGetActivePlan = vi.fn().mockResolvedValue(FREE_PLAN);
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyPlanLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
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

    testProject = projectFactory.build({ slug: nanoid() });
    testProject = await prisma.project.create({
      data: {
        ...testProject,
        teamId: testTeam.id,
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
    if (!testProjectId) return;

    await prisma.simulationSuite.deleteMany({
      where: { projectId: testProjectId },
    });
    await prisma.scenario.deleteMany({
      where: { projectId: testProjectId },
    });
    await prisma.project.delete({
      where: { id: testProjectId },
    });
    await prisma.team.delete({
      where: { id: testTeam.id },
    });
    await prisma.organization.delete({
      where: { id: testOrganization.id },
    });
    resetApp();
  });

  async function createScenario(name: string): Promise<Scenario> {
    return prisma.scenario.create({
      data: {
        projectId: testProjectId,
        name,
        situation: `Testing ${name}`,
        criteria: ["criterion_1"],
        labels: [],
      },
    });
  }

  async function createSuite(overrides: Partial<{
    name: string;
    scenarioIds: string[];
    targets: unknown;
    archivedAt: Date | null;
  }> = {}): Promise<SimulationSuite> {
    const scenario = await createScenario("Test Scenario");
    return prisma.simulationSuite.create({
      data: {
        id: `suite_${nanoid()}`,
        projectId: testProjectId,
        name: overrides.name ?? "Test Suite",
        slug: `test-suite-${nanoid()}`,
        scenarioIds: overrides.scenarioIds ?? [scenario.id],
        targets: overrides.targets ?? [{ type: "http", referenceId: "agent_test" }],
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
      await createSuite({ name: "Duplicate Name", scenarioIds: [scenario.id] });

      const res = await helpers.api.post("/api/suites", {
        name: "Duplicate Name",
        scenarioIds: [scenario.id],
        targets: [{ type: "http", referenceId: "agent_abc" }],
      });

      expect(res.status).toBe(400);
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

      const res = await helpers.api.post(`/api/suites/${suite.id}/duplicate`, {});

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("Original (copy)");
      expect(body.id).not.toBe(suite.id);
    });
  });

  describe("DELETE /api/suites/:id", () => {
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

    it("returns 404 for non-existent suite", async () => {
      const res = await helpers.api.delete("/api/suites/nonexistent-id");

      expect(res.status).toBe(404);
    });
  });
});
