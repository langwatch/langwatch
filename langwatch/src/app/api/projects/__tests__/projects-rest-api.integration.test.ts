import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
  type Organization,
  type Team,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KSUID_RESOURCES } from "~/utils/constants";
import { prisma } from "~/server/db";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { app } from "../[[...route]]/app";

describe("Feature: Projects REST API", () => {
  const ns = `projects-api-${nanoid(8)}`;

  let testOrganization: Organization;
  let testTeam: Team;
  let patToken: string;
  let userId: string;

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

    await prisma.teamUser.create({
      data: {
        userId,
        teamId: testTeam.id,
        role: TeamUserRole.ADMIN,
      },
    });

    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: testOrganization.id,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: testOrganization.id,
      },
    });

    const apiKeyService = ApiKeyService.create(prisma);
    const created = await apiKeyService.create({
      name: `projects-key-${nanoid(6)}`,
      userId,
      createdByUserId: userId,
      organizationId: testOrganization.id,
      permissionMode: "all",
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

  afterAll(async () => {
    await prisma.project.deleteMany({
      where: { team: { organizationId: testOrganization.id } },
    }).catch(() => {});
    await prisma.roleBinding.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.apiKey.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.teamUser.deleteMany({
      where: { userId },
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
  });

  describe("Authentication", () => {
    it("returns 401 without auth header", async () => {
      const res = await app.request("/api/projects");
      expect(res.status).toBe(401);
    });

    it("returns 401 with project API key (org-level endpoint)", async () => {
      const res = await app.request("/api/projects", {
        headers: { "X-Auth-Token": "sk-lw-invalid-key" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid API key", async () => {
      const res = await app.request("/api/projects", {
        headers: { Authorization: "Bearer sk-lw-invalid_token" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/projects", () => {
    it("creates a project and returns it with serviceApiKey", async () => {
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
      expect(body.serviceApiKey).toMatch(/^sk-lw-/);
      expect(body.serviceApiKeyId).toBeDefined();
      expect(body).not.toHaveProperty("apiKey");
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

    it("returns 422 when neither teamId nor newTeamName provided", async () => {
      const res = await api.post("/api/projects", {
        name: "No Team",
        language: "python",
        framework: "langchain",
      });
      expect(res.status).toBe(422);
    });

    it("creates a project with a new team via newTeamName", async () => {
      const res = await api.post("/api/projects", {
        name: "New Team Project",
        newTeamName: `API Team ${nanoid(6)}`,
        language: "typescript",
        framework: "vercel-ai",
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.id).toMatch(/^project_/);
      expect(body.teamId).toMatch(/^team_/);
      expect(body.teamId).not.toBe(testTeam.id);
      expect(body.serviceApiKey).toMatch(/^sk-lw-/);
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
    it("returns a project without apiKey", async () => {
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
      expect(body).not.toHaveProperty("apiKey");
      expect(body).not.toHaveProperty("serviceApiKey");
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

    describe("when moving project to different team", () => {
      let destinationTeam: Team;
      let projectToMove: { id: string; teamId: string };

      beforeAll(async () => {
        destinationTeam = await prisma.team.create({
          data: {
            name: "Move Destination Team",
            slug: `--test-move-dest-${ns}`,
            organizationId: testOrganization.id,
          },
        });

        const createRes = await api.post("/api/projects", {
          name: `Move Test ${nanoid(6)}`,
          teamId: testTeam.id,
          language: "python",
          framework: "langchain",
        });
        projectToMove = await createRes.json();
      });

      it("moves project to a different team in the same org", async () => {
        const res = await api.patch(`/api/projects/${projectToMove.id}`, {
          teamId: destinationTeam.id,
        });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.teamId).toBe(destinationTeam.id);
      });

      it("updates name and team together", async () => {
        const res = await api.patch(`/api/projects/${projectToMove.id}`, {
          name: "Moved And Renamed",
          teamId: testTeam.id,
        });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.name).toBe("Moved And Renamed");
        expect(body.teamId).toBe(testTeam.id);
      });

      it("rejects teamId that does not exist", async () => {
        const res = await api.patch(`/api/projects/${projectToMove.id}`, {
          teamId: "nonexistent-team",
        });
        expect(res.status).toBe(400);
      });

      it("rejects teamId of archived team", async () => {
        const archivedTeam = await prisma.team.create({
          data: {
            name: "Archived Team",
            slug: `--test-archived-${ns}`,
            organizationId: testOrganization.id,
            archivedAt: new Date(),
          },
        });

        const res = await api.patch(`/api/projects/${projectToMove.id}`, {
          teamId: archivedTeam.id,
        });
        expect(res.status).toBe(400);
      });

      it("rejects teamId from different organization", async () => {
        const otherOrg = await prisma.organization.create({
          data: { name: "Other Org", slug: `--test-other-org-${ns}` },
        });
        const otherTeam = await prisma.team.create({
          data: {
            name: "Other Team",
            slug: `--test-other-team-${ns}`,
            organizationId: otherOrg.id,
          },
        });

        const res = await api.patch(`/api/projects/${projectToMove.id}`, {
          teamId: otherTeam.id,
        });
        expect(res.status).toBe(400);

        await prisma.team.delete({ where: { id: otherTeam.id } }).catch(() => {});
        await prisma.organization.delete({ where: { id: otherOrg.id } }).catch(() => {});
      });

      it("does not update name when team validation fails (atomic)", async () => {
        const beforeRes = await api.get(`/api/projects/${projectToMove.id}`);
        const beforeBody = await beforeRes.json();
        const beforeName = beforeBody.name;

        const res = await api.patch(`/api/projects/${projectToMove.id}`, {
          name: "Should Not Persist",
          teamId: "nonexistent-team",
        });
        expect(res.status).toBe(400);

        const afterRes = await api.get(`/api/projects/${projectToMove.id}`);
        const after = await afterRes.json();
        expect(after.name).toBe(beforeName);
      });
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
