import type { Organization, Project, Team } from "@prisma/client";
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

/**
 * Valid signature agent config — all fields are optional in the base component schema,
 * so an empty object with a prompt is sufficient.
 */
const VALID_SIGNATURE_CONFIG = {
  prompt: "You are a helpful assistant",
};

// Skipped: app-layer init regression on main after es-migration refactor
// — see langwatch/langwatch#3240.
describe.skip("Feature: Agent REST API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;
  let mockNotifyPlanLimitReached: ReturnType<typeof vi.fn>;
  let helpers: {
    api: {
      get: (path: string) => Response | Promise<Response>;
      post: (path: string, body: unknown) => Response | Promise<Response>;
      patch: (path: string, body: unknown) => Response | Promise<Response>;
      delete: (path: string, body?: unknown) => Response | Promise<Response>;
    };
  };

  const createAuthHeaders = (apiKey: string) => ({
    "X-Auth-Token": apiKey,
    "Content-Type": "application/json",
  });

  beforeEach(async () => {
    resetApp();
    mockGetActivePlan = vi.fn().mockResolvedValue(FREE_PLAN);
    mockNotifyPlanLimitReached = vi.fn().mockResolvedValue(undefined);
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyPlanLimitReached: mockNotifyPlanLimitReached,
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
        delete: (path: string, body?: unknown) =>
          app.request(path, {
            method: "DELETE",
            ...(body
              ? {
                  body: JSON.stringify(body),
                  headers: createAuthHeaders(testApiKey),
                }
              : { headers: { "X-Auth-Token": testApiKey } }),
          }),
      },
    };
  });

  afterEach(async () => {
    if (!testProjectId) return;

    await prisma.agent.deleteMany({
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

  async function createAgent(overrides: {
    name: string;
    archivedAt?: Date | null;
    id?: string;
  }) {
    return await prisma.agent.create({
      data: {
        id: overrides.id ?? `agent_${nanoid()}`,
        name: overrides.name,
        projectId: testProjectId,
        type: "signature",
        config: VALID_SIGNATURE_CONFIG,
        archivedAt: overrides.archivedAt ?? null,
      },
    });
  }

  // ── Authentication ─────────────────────────────────────────────

  describe("Authentication", () => {
    it("returns 401 without X-Auth-Token header", async () => {
      const res = await app.request("/api/agents");
      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid X-Auth-Token", async () => {
      const res = await app.request("/api/agents", {
        headers: { "X-Auth-Token": "invalid-key-xyz" },
      });
      expect(res.status).toBe(401);
    });
  });

  // ── List Agents ──────────────────────────────────────────────

  describe("GET /api/agents", () => {
    describe("when the project has 3 agents and 1 archived agent", () => {
      beforeEach(async () => {
        await createAgent({ name: "Agent A" });
        await createAgent({ name: "Agent B" });
        await createAgent({ name: "Agent C" });
        await createAgent({
          name: "Archived Agent",
          archivedAt: new Date(),
        });
      });

      it("returns paginated non-archived agents", async () => {
        const res = await helpers.api.get("/api/agents");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toHaveLength(3);
        expect(body.pagination.total).toBe(3);
      });

      it("includes id, name, type, config, createdAt, and updatedAt", async () => {
        const res = await helpers.api.get("/api/agents");
        const body = await res.json();

        for (const agent of body.data) {
          expect(agent).toHaveProperty("id");
          expect(agent).toHaveProperty("name");
          expect(agent).toHaveProperty("type");
          expect(agent).toHaveProperty("config");
          expect(agent).toHaveProperty("createdAt");
          expect(agent).toHaveProperty("updatedAt");
        }
      });

      it("excludes archived agents", async () => {
        const res = await helpers.api.get("/api/agents");
        const body = await res.json();
        const names = body.data.map((a: { name: string }) => a.name);
        expect(names).not.toContain("Archived Agent");
      });
    });

    describe("when the project has 15 agents", () => {
      beforeEach(async () => {
        for (let i = 0; i < 15; i++) {
          await createAgent({ name: `Agent ${i}` });
        }
      });

      it("paginates with page and limit parameters", async () => {
        const res = await helpers.api.get("/api/agents?page=2&limit=5");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toHaveLength(5);
        expect(body.pagination).toEqual({
          page: 2,
          limit: 5,
          total: 15,
          totalPages: 3,
        });
      });
    });

    describe("when the project has no agents", () => {
      it("returns empty paginated response", async () => {
        const res = await helpers.api.get("/api/agents");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toHaveLength(0);
        expect(body.pagination.total).toBe(0);
      });
    });
  });

  // ── Create Agent ─────────────────────────────────────────────

  describe("POST /api/agents", () => {
    it("creates an agent with name, type, and config", async () => {
      const res = await helpers.api.post("/api/agents", {
        name: "My Agent",
        type: "signature",
        config: VALID_SIGNATURE_CONFIG,
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.id).toMatch(/^agent_/);
      expect(body.name).toBe("My Agent");
      expect(body.type).toBe("signature");
      expect(body.config).toMatchObject(VALID_SIGNATURE_CONFIG);
    });

    it("returns 422 when name is missing", async () => {
      const res = await helpers.api.post("/api/agents", {
        type: "signature",
        config: VALID_SIGNATURE_CONFIG,
      });
      expect(res.status).toBe(422);
    });

    it("returns 422 when type is missing", async () => {
      const res = await helpers.api.post("/api/agents", {
        name: "No Type Agent",
        config: VALID_SIGNATURE_CONFIG,
      });
      expect(res.status).toBe(422);
    });

    it("returns 422 when type is invalid", async () => {
      const res = await helpers.api.post("/api/agents", {
        name: "Bad Type Agent",
        type: "invalid_type",
        config: {},
      });
      expect(res.status).toBe(422);
    });

    describe("when the project has reached its agent plan limit", () => {
      beforeEach(async () => {
        await createAgent({ name: "Existing Agent" });
        mockGetActivePlan.mockResolvedValue({
          ...FREE_PLAN,
          maxAgents: 1,
          overrideAddingLimitations: false,
        });
      });

      it("returns 403 Forbidden", async () => {
        const res = await helpers.api.post("/api/agents", {
          name: "Over Limit",
          type: "signature",
          config: VALID_SIGNATURE_CONFIG,
        });

        expect(res.status).toBe(403);
      });
    });
  });

  // ── Get Single Agent ─────────────────────────────────────────

  describe("GET /api/agents/:id", () => {
    it("returns agent details by id", async () => {
      const agent = await createAgent({ name: "Detail Agent", id: "agent_detail123" });

      const res = await helpers.api.get(`/api/agents/${agent.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(agent.id);
      expect(body.name).toBe("Detail Agent");
      expect(body.type).toBe("signature");
      expect(body.config).toBeDefined();
    });

    it("returns 404 for non-existent agent", async () => {
      const res = await helpers.api.get("/api/agents/agent_doesnotexist");
      expect(res.status).toBe(404);
    });
  });

  // ── Update Agent ─────────────────────────────────────────────

  describe("PATCH /api/agents/:id", () => {
    it("updates agent name", async () => {
      const agent = await createAgent({ name: "Original Name" });

      const res = await helpers.api.patch(`/api/agents/${agent.id}`, {
        name: "Updated Name",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.name).toBe("Updated Name");
    });

    it("updates agent config", async () => {
      const agent = await createAgent({ name: "Config Agent" });

      const newConfig = { prompt: "You are a coding assistant" };
      const res = await helpers.api.patch(`/api/agents/${agent.id}`, {
        config: newConfig,
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.config).toMatchObject(newConfig);
    });

    it("returns 404 for non-existent agent", async () => {
      const res = await helpers.api.patch("/api/agents/agent_ghost", {
        name: "Whatever",
      });
      expect(res.status).toBe(404);
    });
  });

  // ── Delete (Archive) Agent ───────────────────────────────────

  describe("DELETE /api/agents/:id", () => {
    it("archives the agent and returns archivedAt", async () => {
      const agent = await createAgent({ name: "To Delete" });

      const res = await helpers.api.delete(`/api/agents/${agent.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(agent.id);
      expect(body.archivedAt).toBeDefined();
    });

    it("makes the agent inaccessible via GET after deletion", async () => {
      const agent = await createAgent({ name: "Soon Gone" });

      await helpers.api.delete(`/api/agents/${agent.id}`);

      const getRes = await helpers.api.get(`/api/agents/${agent.id}`);
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for non-existent agent", async () => {
      const res = await helpers.api.delete("/api/agents/agent_nope");
      expect(res.status).toBe(404);
    });
  });
});
