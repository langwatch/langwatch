import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
  type Organization,
  type Team,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  PlanProviderService,
  type PlanProvider,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { PatService } from "~/server/pat/pat.service";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { app } from "../[[...route]]/app";

describe("Feature: Projects REST API", () => {
  const ns = `projects-api-${nanoid(8)}`;

  let testOrganization: Organization;
  let testTeam: Team;
  let patToken: string;
  let userId: string;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;

  const authHeaders = () => ({
    Authorization: `Bearer ${patToken}`,
    "Content-Type": "application/json",
  });

  const api = {
    get: (path: string) =>
      app.request(path, { headers: authHeaders() }),
    post: (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      }),
    patch: (path: string, body: unknown) =>
      app.request(path, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(body),
      }),
    delete: (path: string) =>
      app.request(path, {
        method: "DELETE",
        headers: authHeaders(),
      }),
  };

  beforeAll(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "Projects Test Org", slug: `--test-org-${ns}` },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Projects Test Team",
        slug: `--test-team-${ns}`,
        organizationId: testOrganization.id,
      },
    });

    const user = await prisma.user.create({
      data: {
        name: "Projects Test User",
        email: `test-${ns}@example.com`,
      },
    });
    userId = user.id;

    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });

    const patService = PatService.create(prisma);
    const created = await patService.create({
      name: `projects-pat-${nanoid(6)}`,
      userId,
      organizationId: testOrganization.id,
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: testOrganization.id,
        },
      ],
    });
    patToken = created.token;
  });

  beforeEach(() => {
    resetApp();
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
  });

  afterAll(async () => {
    await prisma.project.deleteMany({
      where: { team: { organizationId: testOrganization.id } },
    }).catch(() => {});
    await prisma.roleBinding.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.personalAccessToken.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.teamUser.deleteMany({
      where: { teamId: testTeam.id },
    }).catch(() => {});
    await prisma.organizationUser.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.team.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.organization.delete({
      where: { id: testOrganization.id },
    }).catch(() => {});
    resetApp();
  });

  describe("Authentication", () => {
    it("returns 401 without auth header", async () => {
      const res = await app.request("/api/projects");
      expect(res.status).toBe(401);
    });

    it("returns 401 with legacy project key (not a PAT)", async () => {
      const res = await app.request("/api/projects", {
        headers: { "X-Auth-Token": "sk-lw-invalid-key" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid PAT", async () => {
      const res = await app.request("/api/projects", {
        headers: { Authorization: "Bearer pat-lw-invalid_token" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/projects", () => {
    it("creates a project and returns it with apiKey", async () => {
      const res = await api.post("/api/projects", {
        name: "My Test Project",
        teamId: testTeam.id,
        language: "python",
        framework: "langchain",
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.id).toMatch(/^project_/);
      expect(body.name).toBe("My Test Project");
      expect(body.slug).toContain("my-test-project");
      expect(body.apiKey).toMatch(/^sk-lw-/);
      expect(body.language).toBe("python");
      expect(body.framework).toBe("langchain");
      expect(body.teamId).toBe(testTeam.id);
    });

    it("returns 422 when name is missing", async () => {
      const res = await api.post("/api/projects", {
        teamId: testTeam.id,
        language: "python",
        framework: "langchain",
      });
      expect(res.status).toBe(422);
    });

    it("returns 422 when teamId is missing", async () => {
      const res = await api.post("/api/projects", {
        name: "No Team",
        language: "python",
        framework: "langchain",
      });
      expect(res.status).toBe(422);
    });

    it("returns 400 when team does not belong to org", async () => {
      const res = await api.post("/api/projects", {
        name: "Wrong Team",
        teamId: "nonexistent-team-id",
        language: "python",
        framework: "langchain",
      });
      expect(res.status).toBe(400);
    });

    describe("when project plan limit is reached", () => {
      it("returns 403", async () => {
        mockGetActivePlan.mockResolvedValue({
          ...FREE_PLAN,
          maxProjects: 0,
          overrideAddingLimitations: false,
        });

        const res = await api.post("/api/projects", {
          name: "Over Limit",
          teamId: testTeam.id,
          language: "python",
          framework: "langchain",
        });
        expect(res.status).toBe(403);
      });
    });
  });

  describe("GET /api/projects", () => {
    it("lists non-archived projects for the organization", async () => {
      const res = await api.get("/api/projects");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
    });

    it("does not include apiKey in list response", async () => {
      await api.post("/api/projects", {
        name: `List Test ${nanoid(6)}`,
        teamId: testTeam.id,
        language: "python",
        framework: "langchain",
      });

      const res = await api.get("/api/projects");
      const body = await res.json();
      for (const project of body.data) {
        expect(project).not.toHaveProperty("apiKey");
      }
    });

    it("paginates results", async () => {
      const res = await api.get("/api/projects?page=1&limit=2");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.pagination.limit).toBe(2);
    });
  });

  describe("GET /api/projects/:id", () => {
    it("returns a project with apiKey", async () => {
      const createRes = await api.post("/api/projects", {
        name: `Get Test ${nanoid(6)}`,
        teamId: testTeam.id,
        language: "typescript",
        framework: "vercel-ai",
      });
      const created = await createRes.json();

      const res = await api.get(`/api/projects/${created.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(created.id);
      expect(body.apiKey).toMatch(/^sk-lw-/);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await api.get("/api/projects/project_doesnotexist");
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/projects/:id", () => {
    it("updates project fields", async () => {
      const createRes = await api.post("/api/projects", {
        name: `Patch Test ${nanoid(6)}`,
        teamId: testTeam.id,
        language: "python",
        framework: "langchain",
      });
      const created = await createRes.json();

      const res = await api.patch(`/api/projects/${created.id}`, {
        name: "Updated Project Name",
        language: "typescript",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.name).toBe("Updated Project Name");
      expect(body.language).toBe("typescript");
      expect(body.framework).toBe("langchain");
    });

    it("returns 404 for non-existent project", async () => {
      const res = await api.patch("/api/projects/project_ghost", {
        name: "Whatever",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/projects/:id", () => {
    it("archives the project", async () => {
      const createRes = await api.post("/api/projects", {
        name: `Delete Test ${nanoid(6)}`,
        teamId: testTeam.id,
        language: "python",
        framework: "langchain",
      });
      const created = await createRes.json();

      const res = await api.delete(`/api/projects/${created.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(created.id);
      expect(body.archivedAt).toBeDefined();
    });

    it("makes the project inaccessible via GET after archival", async () => {
      const createRes = await api.post("/api/projects", {
        name: `Archive Test ${nanoid(6)}`,
        teamId: testTeam.id,
        language: "python",
        framework: "langchain",
      });
      const created = await createRes.json();

      await api.delete(`/api/projects/${created.id}`);

      const getRes = await api.get(`/api/projects/${created.id}`);
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await api.delete("/api/projects/project_nope");
      expect(res.status).toBe(404);
    });
  });
});
