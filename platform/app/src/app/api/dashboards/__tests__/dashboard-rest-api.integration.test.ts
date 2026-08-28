import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { WORKBENCH_SQL_CHART_KIND } from "~/server/analytics/chartKinds";
import { getApp, globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import { createDashboardsRestApp } from "@langwatch/platform-api";
import { appRestSecurity } from "~/server/api/security";
import { platformUrl } from "../../shared/platform-url";

/**
 * Built here the way the process builds it, because the family is packaged
 * now: the service is resolved per request off whatever App the test has
 * installed, so `resetApp()` between cases still swaps what the routes reach.
 */
const app = createDashboardsRestApp({
  security: appRestSecurity,
  dashboard: () => getApp().dashboard,
  platformUrl,
}).hono;

/**
 * Distinctive enough that a substring search over the whole serialised body
 * cannot miss it, and cannot match by coincidence.
 */
const SECRET_SQL =
  "SELECT CapturedInput AS leaked_marker_7f3a FROM analytics.traces";

describe("Feature: Dashboard REST API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;
  let helpers: {
    api: {
      get: (path: string) => Response | Promise<Response>;
      post: (path: string, body: unknown) => Response | Promise<Response>;
      patch: (path: string, body: unknown) => Response | Promise<Response>;
      put: (path: string, body: unknown) => Response | Promise<Response>;
      delete: (path: string) => Response | Promise<Response>;
    };
  };

  const createAuthHeaders = (apiKey: string) => ({
    "X-Auth-Token": apiKey,
    "Content-Type": "application/json",
  });

  beforeEach(async () => {
    await resetApp();
    mockGetActivePlan = vi.fn().mockResolvedValue(FREE_PLAN);
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
      ["customGraph", { projectId: testProjectId }],
      ["dashboard", { projectId: testProjectId }],
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

  async function createDashboard(overrides: {
    name: string;
    order?: number;
    id?: string;
  }) {
    return await prisma.dashboard.create({
      data: {
        id: overrides.id ?? nanoid(),
        name: overrides.name,
        projectId: testProjectId,
        order: overrides.order ?? 0,
      },
    });
  }

  async function createGraph(
    dashboardId: string,
    overrides?: { gridRow?: number; gridColumn?: number },
  ) {
    return await prisma.customGraph.create({
      data: {
        id: nanoid(),
        projectId: testProjectId,
        dashboardId,
        name: `Graph ${nanoid(6)}`,
        graph: {},
        gridRow: overrides?.gridRow ?? 0,
        gridColumn: overrides?.gridColumn ?? 0,
      },
    });
  }

  /**
   * A saved LangWatchQL workbench chart placed on a dashboard. Its `graph`
   * column holds the member's statement, which is exactly what must not appear
   * in a REST response.
   */
  async function createWorkbenchChart(dashboardId: string) {
    return await prisma.customGraph.create({
      data: {
        id: nanoid(),
        projectId: testProjectId,
        dashboardId,
        name: `Workbench ${nanoid(6)}`,
        kind: WORKBENCH_SQL_CHART_KIND,
        graph: {
          version: 1,
          sql: SECRET_SQL,
          parameters: {},
        },
        gridRow: 0,
        gridColumn: 0,
      },
    });
  }

  // ── Authentication ─────────────────────────────────────────────

  describe("Authentication", () => {
    it("returns 401 without X-Auth-Token header", async () => {
      const res = await app.request("/api/dashboards");
      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid X-Auth-Token", async () => {
      const res = await app.request("/api/dashboards", {
        headers: { "X-Auth-Token": "invalid-key-xyz" },
      });
      expect(res.status).toBe(401);
    });
  });

  // ── List Dashboards ──────────────────────────────────────────

  describe("GET /api/dashboards", () => {
    describe("when the project has dashboards", () => {
      beforeEach(async () => {
        const d1 = await createDashboard({ name: "Dashboard A", order: 0 });
        const d2 = await createDashboard({ name: "Dashboard B", order: 1 });
        await createGraph(d1.id);
        await createGraph(d1.id);
        await createGraph(d2.id);
      });

      it("returns all dashboards ordered by position with graph counts", async () => {
        const res = await helpers.api.get("/api/dashboards");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toHaveLength(2);
        expect(body.data[0].name).toBe("Dashboard A");
        expect(body.data[0].graphCount).toBe(2);
        expect(body.data[1].name).toBe("Dashboard B");
        expect(body.data[1].graphCount).toBe(1);
      });

      it("includes id, name, order, graphCount, createdAt, and updatedAt", async () => {
        const res = await helpers.api.get("/api/dashboards");
        const body = await res.json();

        for (const dashboard of body.data) {
          expect(dashboard).toHaveProperty("id");
          expect(dashboard).toHaveProperty("name");
          expect(dashboard).toHaveProperty("order");
          expect(dashboard).toHaveProperty("graphCount");
          expect(dashboard).toHaveProperty("createdAt");
          expect(dashboard).toHaveProperty("updatedAt");
        }
      });
    });

    describe("when the project has no dashboards", () => {
      it("returns empty data array", async () => {
        const res = await helpers.api.get("/api/dashboards");
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toHaveLength(0);
      });
    });
  });

  // ── Create Dashboard ─────────────────────────────────────────

  describe("POST /api/dashboards", () => {
    it("creates a dashboard and returns 201", async () => {
      const res = await helpers.api.post("/api/dashboards", {
        name: "My Dashboard",
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe("My Dashboard");
      expect(body.order).toBe(0);
      expect(body.createdAt).toBeDefined();
    });

    it("auto-increments order for subsequent dashboards", async () => {
      await createDashboard({ name: "Existing", order: 2 });

      const res = await helpers.api.post("/api/dashboards", {
        name: "New Dashboard",
      });
      const body = await res.json();
      expect(body.order).toBe(3);
    });

    it("returns 422 when name is missing", async () => {
      const res = await helpers.api.post("/api/dashboards", {});
      expect(res.status).toBe(422);
    });

    it("returns 422 when name is empty string", async () => {
      const res = await helpers.api.post("/api/dashboards", { name: "" });
      expect(res.status).toBe(422);
    });
  });

  // ── Get Single Dashboard ─────────────────────────────────────

  describe("GET /api/dashboards/:id", () => {
    it("returns dashboard with its graphs ordered by grid position", async () => {
      const dashboard = await createDashboard({ name: "Detail Dashboard" });
      await createGraph(dashboard.id, { gridRow: 1, gridColumn: 0 });
      await createGraph(dashboard.id, { gridRow: 0, gridColumn: 1 });
      await createGraph(dashboard.id, { gridRow: 0, gridColumn: 0 });

      const res = await helpers.api.get(`/api/dashboards/${dashboard.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(dashboard.id);
      expect(body.name).toBe("Detail Dashboard");
      expect(body.graphs).toHaveLength(3);
      // Ordered by gridRow asc, gridColumn asc
      expect(body.graphs[0].gridRow).toBe(0);
      expect(body.graphs[0].gridColumn).toBe(0);
      expect(body.graphs[1].gridRow).toBe(0);
      expect(body.graphs[1].gridColumn).toBe(1);
      expect(body.graphs[2].gridRow).toBe(1);
    });

    it("returns 404 for non-existent dashboard", async () => {
      const res = await helpers.api.get("/api/dashboards/nonexistent-id");
      expect(res.status).toBe(404);
    });
  });

  // ── Rename Dashboard ─────────────────────────────────────────

  describe("PATCH /api/dashboards/:id", () => {
    it("renames the dashboard", async () => {
      const dashboard = await createDashboard({ name: "Original Name" });

      const res = await helpers.api.patch(`/api/dashboards/${dashboard.id}`, {
        name: "Updated Name",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.name).toBe("Updated Name");
    });

    it("returns 404 for non-existent dashboard", async () => {
      const res = await helpers.api.patch("/api/dashboards/nonexistent-id", {
        name: "Whatever",
      });
      expect(res.status).toBe(404);
    });

    it("returns 422 when name is empty", async () => {
      const dashboard = await createDashboard({ name: "Test" });

      const res = await helpers.api.patch(`/api/dashboards/${dashboard.id}`, {
        name: "",
      });
      expect(res.status).toBe(422);
    });
  });

  // ── Delete Dashboard ─────────────────────────────────────────

  describe("DELETE /api/dashboards/:id", () => {
    it("deletes the dashboard and cascades to graphs", async () => {
      const dashboard = await createDashboard({ name: "To Delete" });
      await createGraph(dashboard.id);
      await createGraph(dashboard.id);

      const res = await helpers.api.delete(`/api/dashboards/${dashboard.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(dashboard.id);
      expect(body.name).toBe("To Delete");

      // Verify it's gone
      const getRes = await helpers.api.get(`/api/dashboards/${dashboard.id}`);
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for non-existent dashboard", async () => {
      const res = await helpers.api.delete("/api/dashboards/nonexistent-id");
      expect(res.status).toBe(404);
    });
  });

  // ── Reorder Dashboards ───────────────────────────────────────

  describe("PUT /api/dashboards/reorder", () => {
    it("reorders dashboards according to the provided ID order", async () => {
      const d1 = await createDashboard({ name: "First", order: 0 });
      const d2 = await createDashboard({ name: "Second", order: 1 });
      const d3 = await createDashboard({ name: "Third", order: 2 });

      const res = await helpers.api.put("/api/dashboards/reorder", {
        dashboardIds: [d3.id, d1.id, d2.id],
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify new order via list
      const listRes = await helpers.api.get("/api/dashboards");
      const listBody = await listRes.json();
      expect(listBody.data[0].name).toBe("Third");
      expect(listBody.data[1].name).toBe("First");
      expect(listBody.data[2].name).toBe("Second");
    });

    it("returns 400 when dashboardIds references non-existent dashboards", async () => {
      const d1 = await createDashboard({ name: "Existing", order: 0 });

      const res = await helpers.api.put("/api/dashboards/reorder", {
        dashboardIds: [d1.id, "nonexistent-id"],
      });
      expect(res.status).toBe(400);
    });

    it("returns 422 when dashboardIds is empty", async () => {
      const res = await helpers.api.put("/api/dashboards/reorder", {
        dashboardIds: [],
      });
      expect(res.status).toBe(422);
    });
  });

  // ── Chart-kind isolation ─────────────────────────────────────

  // The `kind` discriminator promises that neither chart shape sees the
  // other's rows. This is that promise on the way *out*: the REST reader
  // serialises each graph row wholesale, so a workbench row reaching it would
  // publish a member's stored SQL to any project API key.
  describe("when a workbench chart is placed on the dashboard being read", () => {
    /** @scenario "A saved workbench chart is not exposed through the dashboard REST API" */
    it("omits the workbench chart from the graphs it returns", async () => {
      const dashboard = await createDashboard({ name: "Mixed" });
      const builderGraph = await createGraph(dashboard.id);
      await createWorkbenchChart(dashboard.id);

      const res = await helpers.api.get(`/api/dashboards/${dashboard.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.graphs.map((graph: { id: string }) => graph.id)).toEqual([
        builderGraph.id,
      ]);
    });

    it("does not carry the stored statement anywhere in the response", async () => {
      const dashboard = await createDashboard({ name: "Mixed" });
      await createGraph(dashboard.id);
      await createWorkbenchChart(dashboard.id);

      const res = await helpers.api.get(`/api/dashboards/${dashboard.id}`);
      expect(res.status).toBe(200);

      const raw = await res.text();

      // Asserted over the whole body rather than over `graphs`: the claim is
      // that the SQL is not in the response *at all*, which a shape-scoped
      // assertion would not catch if a later field carried it.
      expect(raw).not.toContain("leaked_marker_7f3a");
    });

    /** @scenario "The list's graphCount matches what the detail response actually returns" */
    it("does not count the workbench chart the detail response omits", async () => {
      const dashboard = await createDashboard({ name: "Mixed" });
      await createGraph(dashboard.id);
      await createWorkbenchChart(dashboard.id);

      const detailRes = await helpers.api.get(
        `/api/dashboards/${dashboard.id}`,
      );
      const detailBody = await detailRes.json();

      const listRes = await helpers.api.get("/api/dashboards");
      const listBody = await listRes.json();
      const listed = listBody.data.find(
        (d: { id: string }) => d.id === dashboard.id,
      );

      // The list's count and the detail's array are two views of one
      // resource — a caller that reads graphCount and then fetches the
      // detail must see the same number of cards in both.
      expect(listed.graphCount).toBe(detailBody.graphs.length);
      expect(listed.graphCount).toBe(1);
    });
  });
});
