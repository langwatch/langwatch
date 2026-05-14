import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
  type Organization,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KSUID_RESOURCES } from "~/utils/constants";
import { prisma } from "~/server/db";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { app } from "../[[...route]]/app";

describe("Feature: Teams REST API", () => {
  const ns = `teams-api-${nanoid(8)}`;

  let testOrganization: Organization;
  let otherOrganization: Organization;
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
      data: { name: "Teams Test Org", slug: `--test-org-${ns}` },
    });

    otherOrganization = await prisma.organization.create({
      data: { name: "Other Org", slug: `--other-org-${ns}` },
    });

    const user = await prisma.user.create({
      data: {
        name: "Teams Test User",
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
      name: `teams-key-${nanoid(6)}`,
      userId,
      createdByUserId: userId,
      organizationId: testOrganization.id,
      permissionMode: "scoped",
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
    await prisma.team.deleteMany({
      where: { organizationId: { in: [testOrganization.id, otherOrganization.id] } },
    }).catch(() => {});
    await prisma.roleBinding.deleteMany({
      where: { organizationId: { in: [testOrganization.id, otherOrganization.id] } },
    }).catch(() => {});
    await prisma.apiKey.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.organizationUser.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.organization.deleteMany({
      where: { id: { in: [testOrganization.id, otherOrganization.id] } },
    }).catch(() => {});
  });

  describe("Authentication", () => {
    it("returns 401 without auth header", async () => {
      const res = await app.request("/api/teams");
      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid API key", async () => {
      const res = await app.request("/api/teams", {
        headers: { Authorization: "Bearer sk-lw-invalid_token" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/teams", () => {
    it("creates a team and returns 201", async () => {
      const res = await api.post("/api/teams", {
        name: "My Test Team",
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.id).toMatch(/^team_/);
      expect(body.name).toBe("My Test Team");
      expect(body.slug).toContain("my-test-team");
      expect(body.organizationId).toBe(testOrganization.id);
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
    });

    it("returns 422 when name is missing", async () => {
      const res = await api.post("/api/teams", {});
      expect(res.status).toBe(422);

      const body = await res.json();
      expect(body.error).toBe("Unprocessable Entity");
    });

    it("returns 422 when name is empty", async () => {
      const res = await api.post("/api/teams", { name: "" });
      expect(res.status).toBe(422);
    });

    it("returns 422 when name exceeds 255 characters", async () => {
      const res = await api.post("/api/teams", { name: "a".repeat(256) });
      expect(res.status).toBe(422);
    });
  });

  describe("GET /api/teams", () => {
    it("lists non-archived teams for the organization", async () => {
      const res = await api.get("/api/teams");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
    });

    it("paginates results", async () => {
      const res = await api.get("/api/teams?page=1&limit=2");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.pagination.limit).toBe(2);
    });

    it("excludes teams from other organizations", async () => {
      await prisma.team.create({
        data: {
          name: "Other Org Team",
          slug: `--other-team-${nanoid(8)}`,
          organizationId: otherOrganization.id,
        },
      });

      const res = await api.get("/api/teams");
      const body = await res.json();

      for (const team of body.data) {
        expect(team.organizationId).toBe(testOrganization.id);
      }
    });
  });

  describe("GET /api/teams/:id", () => {
    it("returns a team by id", async () => {
      const createRes = await api.post("/api/teams", {
        name: `Get Test ${nanoid(6)}`,
      });
      const created = await createRes.json();

      const res = await api.get(`/api/teams/${created.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(created.id);
      expect(body.name).toBe(created.name);
    });

    it("returns 404 for non-existent team", async () => {
      const res = await api.get("/api/teams/team_doesnotexist");
      expect(res.status).toBe(404);
    });

    it("returns 404 for team in another organization", async () => {
      const otherTeam = await prisma.team.create({
        data: {
          name: "Cross Org Team",
          slug: `--cross-org-${nanoid(8)}`,
          organizationId: otherOrganization.id,
        },
      });

      const res = await api.get(`/api/teams/${otherTeam.id}`);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/teams/:id", () => {
    it("updates team name", async () => {
      const createRes = await api.post("/api/teams", {
        name: `Patch Test ${nanoid(6)}`,
      });
      const created = await createRes.json();

      const res = await api.patch(`/api/teams/${created.id}`, {
        name: "Updated Team Name",
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.name).toBe("Updated Team Name");
      expect(body.id).toBe(created.id);
    });

    it("returns 404 for non-existent team", async () => {
      const res = await api.patch("/api/teams/team_ghost", {
        name: "Whatever",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/teams/:id", () => {
    it("archives the team", async () => {
      const createRes = await api.post("/api/teams", {
        name: `Delete Test ${nanoid(6)}`,
      });
      const created = await createRes.json();

      const res = await api.delete(`/api/teams/${created.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe(created.id);
      expect(body.archivedAt).toBeDefined();
    });

    it("makes the team inaccessible via GET after archival", async () => {
      const createRes = await api.post("/api/teams", {
        name: `Archive Test ${nanoid(6)}`,
      });
      const created = await createRes.json();

      await api.delete(`/api/teams/${created.id}`);

      const getRes = await api.get(`/api/teams/${created.id}`);
      expect(getRes.status).toBe(404);
    });

    it("excludes archived teams from list", async () => {
      const createRes = await api.post("/api/teams", {
        name: `Archive List Test ${nanoid(6)}`,
      });
      const created = await createRes.json();

      await api.delete(`/api/teams/${created.id}`);

      const listRes = await api.get("/api/teams");
      const body = await listRes.json();
      const ids = body.data.map((t: { id: string }) => t.id);
      expect(ids).not.toContain(created.id);
    });

    it("returns 404 for non-existent team", async () => {
      const res = await api.delete("/api/teams/team_nope");
      expect(res.status).toBe(404);
    });
  });
});
