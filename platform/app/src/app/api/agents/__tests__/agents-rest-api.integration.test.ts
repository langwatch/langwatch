import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { AGENTS_ALIAS_SUCCESSOR, app as aliasApp } from "../[[...route]]/alias";
import { app } from "../[[...route]]/app";

/**
 * Valid signature agent config — all fields are optional in the base component schema,
 * so an empty object with a prompt is sufficient.
 */
const VALID_SIGNATURE_CONFIG = {
  prompt: "You are a helpful assistant",
};

describe("Feature: Agent REST API", () => {
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
      put: (path: string, body: unknown) => Response | Promise<Response>;
      delete: (path: string, body?: unknown) => Response | Promise<Response>;
    };
  };

  const createAuthHeaders = (apiKey: string) => ({
    "X-Auth-Token": apiKey,
    "Content-Type": "application/json",
  });

  beforeEach(async () => {
    await resetApp();
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
        put: (path: string, body: unknown) =>
          app.request(path, {
            method: "PUT",
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
    await cleanupTestRows(prisma, [["agent", { projectId: testProjectId }]]);
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
    /** @scenario Request without API key returns 401 */
    it("returns 401 without X-Auth-Token header", async () => {
      const res = await app.request("/api/v1/agents");
      expect(res.status).toBe(401);
    });

    /** @scenario Request with invalid API key returns 401 */
    it("returns 401 with invalid X-Auth-Token", async () => {
      const res = await app.request("/api/v1/agents", {
        headers: { "X-Auth-Token": "invalid-key-xyz" },
      });
      expect(res.status).toBe(401);
    });
  });

  // ── List Agents ──────────────────────────────────────────────

  describe("GET /api/v1/agents", () => {
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

      /** @scenario List agents returns paginated non-archived agents */
      it("returns paginated non-archived agents", async () => {
        const res = await helpers.api.get("/api/v1/agents");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toHaveLength(3);
        expect(body.pagination.total).toBe(3);
      });

      it("includes id, name, type, config, createdAt, and updatedAt", async () => {
        const res = await helpers.api.get("/api/v1/agents");
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
        const res = await helpers.api.get("/api/v1/agents");
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

      /** @scenario List agents with page and limit parameters */
      it("paginates with page and limit parameters", async () => {
        const res = await helpers.api.get("/api/v1/agents?page=2&limit=5");
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
      /** @scenario List agents returns empty array for project with no agents */
      it("returns empty paginated response", async () => {
        const res = await helpers.api.get("/api/v1/agents");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toHaveLength(0);
        expect(body.pagination.total).toBe(0);
      });
    });
  });

  // ── Create Agent ─────────────────────────────────────────────

  describe("POST /api/v1/agents", () => {
    /** @scenario Create an agent with name, type, and config */
    it("creates an agent with name, type, and config", async () => {
      const res = await helpers.api.post("/api/v1/agents", {
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

    /** @scenario Create an agent requires a name */
    it("returns 422 when name is missing", async () => {
      const res = await helpers.api.post("/api/v1/agents", {
        type: "signature",
        config: VALID_SIGNATURE_CONFIG,
      });
      expect(res.status).toBe(422);
    });

    /** @scenario Create an agent requires a type */
    it("returns 422 when type is missing", async () => {
      const res = await helpers.api.post("/api/v1/agents", {
        name: "No Type Agent",
        config: VALID_SIGNATURE_CONFIG,
      });
      expect(res.status).toBe(422);
    });

    /** @scenario Create an agent validates config against type schema */
    it("returns 422 when type is invalid", async () => {
      const res = await helpers.api.post("/api/v1/agents", {
        name: "Bad Type Agent",
        type: "invalid_type",
        config: {},
      });
      expect(res.status).toBe(422);
    });
  });

  // ── Get Single Agent ─────────────────────────────────────────

  describe("GET /api/v1/agents/:id", () => {
    /** @scenario Get an agent by id */
    it("returns agent details by id", async () => {
      const agent = await createAgent({
        name: "Detail Agent",
        id: "agent_detail123",
      });

      const res = await helpers.api.get(`/api/v1/agents/${agent.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(agent.id);
      expect(body.name).toBe("Detail Agent");
      expect(body.type).toBe("signature");
      expect(body.config).toBeDefined();
      // The platform link addresses THIS agent (its editor drawer), never the
      // bare /agents index.
      expect(body.platformUrl).toContain(
        `drawer.agentId=${encodeURIComponent(agent.id)}`,
      );
    });

    /** @scenario Get agent returns 404 for non-existent id */
    it("returns 404 for non-existent agent", async () => {
      const res = await helpers.api.get("/api/v1/agents/agent_doesnotexist");
      expect(res.status).toBe(404);
    });
  });

  // ── Update Agent ─────────────────────────────────────────────

  describe("PATCH /api/v1/agents/:id", () => {
    /** @scenario Update an agent name */
    it("updates agent name", async () => {
      const agent = await createAgent({ name: "Original Name" });

      const res = await helpers.api.patch(`/api/v1/agents/${agent.id}`, {
        name: "Updated Name",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.name).toBe("Updated Name");
    });

    /** @scenario Update an agent config */
    it("updates agent config", async () => {
      const agent = await createAgent({ name: "Config Agent" });

      const newConfig = { prompt: "You are a coding assistant" };
      const res = await helpers.api.patch(`/api/v1/agents/${agent.id}`, {
        config: newConfig,
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.config).toMatchObject(newConfig);
    });

    /** @scenario Update a non-existent agent returns 404 */
    it("returns 404 for non-existent agent", async () => {
      const res = await helpers.api.patch("/api/v1/agents/agent_ghost", {
        name: "Whatever",
      });
      expect(res.status).toBe(404);
    });

    /** @scenario Update an agent with PUT */
    it("accepts PUT as well as PATCH", async () => {
      const agent = await createAgent({ name: "Verb Agent" });

      const res = await helpers.api.put(`/api/v1/agents/${agent.id}`, {
        name: "Renamed By Put",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.name).toBe("Renamed By Put");
    });
  });

  // ── Delete (Archive) Agent ───────────────────────────────────

  describe("DELETE /api/v1/agents/:id", () => {
    /** @scenario Delete an agent archives it */
    it("archives the agent and returns archivedAt", async () => {
      const agent = await createAgent({ name: "To Delete" });

      const res = await helpers.api.delete(`/api/v1/agents/${agent.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(agent.id);
      expect(body.archivedAt).toBeDefined();
    });

    it("makes the agent inaccessible via GET after deletion", async () => {
      const agent = await createAgent({ name: "Soon Gone" });

      await helpers.api.delete(`/api/v1/agents/${agent.id}`);

      const getRes = await helpers.api.get(`/api/v1/agents/${agent.id}`);
      expect(getRes.status).toBe(404);
    });

    /** @scenario Delete a non-existent agent returns 404 */
    it("returns 404 for non-existent agent", async () => {
      const res = await helpers.api.delete("/api/v1/agents/agent_nope");
      expect(res.status).toBe(404);
    });
  });
  // ── Deprecated alias ─────────────────────────────────────────

  describe("the deprecated /api/agents alias", () => {
    const aliasGet = (path: string) =>
      aliasApp.request(path, { headers: createAuthHeaders(testApiKey) });

    /** @scenario The alias answers the endpoints that predate the move */
    it("lists, reads, updates and archives agents at /api/agents", async () => {
      const agent = await createAgent({ name: "Alias Agent" });

      const list = await aliasGet("/api/agents");
      expect(list.status).toBe(200);
      const listBody = await list.json();
      expect(listBody.data.map((a: { id: string }) => a.id)).toContain(
        agent.id,
      );

      const read = await aliasGet(`/api/agents/${agent.id}`);
      expect(read.status).toBe(200);
      expect((await read.json()).name).toBe("Alias Agent");

      const renamed = await aliasApp.request(`/api/agents/${agent.id}`, {
        method: "PATCH",
        headers: createAuthHeaders(testApiKey),
        body: JSON.stringify({ name: "Alias Renamed" }),
      });
      expect(renamed.status).toBe(200);
      expect((await renamed.json()).name).toBe("Alias Renamed");

      const archived = await aliasApp.request(`/api/agents/${agent.id}`, {
        method: "DELETE",
        headers: createAuthHeaders(testApiKey),
      });
      expect(archived.status).toBe(200);
      expect((await archived.json()).id).toBe(agent.id);
    });

    /** @scenario Every alias response carries the deprecation headers */
    it("names the successor on every response", async () => {
      const res = await aliasGet("/api/agents");
      expect(res.status).toBe(200);
      expect(res.headers.get("Deprecation")).toBe("true");
      expect(res.headers.get("Link")).toBe(
        `<${AGENTS_ALIAS_SUCCESSOR}>; rel="successor-version"`,
      );
    });

    /** @scenario A refused alias request still carries the deprecation headers */
    it("keeps the headers on a 404", async () => {
      const res = await aliasGet("/api/agents/agent_nope");
      expect(res.status).toBe(404);
      expect(res.headers.get("Deprecation")).toBe("true");
      expect((await res.json()).code).toBe("agent_not_found");
    });

    /** @scenario The endpoints added with the move answer only under /api/v1 */
    it("does not serve the test, call and connect endpoints", async () => {
      const agent = await createAgent({ name: "Alias Only" });
      const refused = await Promise.all([
        aliasApp.request(`/api/agents/${agent.id}/test`, {
          method: "POST",
          headers: createAuthHeaders(testApiKey),
        }),
        aliasApp.request(`/api/agents/${agent.id}/call`, {
          method: "POST",
          headers: createAuthHeaders(testApiKey),
          body: JSON.stringify({ messages: [] }),
        }),
        aliasApp.request("/api/agents/connect/poll", {
          headers: createAuthHeaders(testApiKey),
        }),
      ]);
      // GET /connect/poll is read as GET /:id, which is a 404 for an
      // id the project does not hold; the two POSTs match no alias route.
      expect(refused.map((r) => r.status)).toEqual([404, 404, 404]);
    });
  });
});
