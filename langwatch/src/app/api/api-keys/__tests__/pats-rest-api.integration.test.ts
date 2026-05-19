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

describe("Feature: API Keys REST API", () => {
  const ns = `api-keys-api-${nanoid(8)}`;

  let testOrganization: Organization;
  let testTeam: Team;
  let testProjectId: string;
  let bootstrapToken: string;
  let userId: string;

  const authHeaders = () => ({
    Authorization: `Bearer ${bootstrapToken}`,
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
    delete: (path: string) =>
      app.request(path, {
        method: "DELETE",
        headers: authHeaders(),
      }),
  };

  beforeAll(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "API Keys Test Org", slug: `--test-org-${ns}` },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "API Keys Test Team",
        slug: `--test-team-${ns}`,
        organizationId: testOrganization.id,
      },
    });

    const user = await prisma.user.create({
      data: {
        name: "API Keys Test User",
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

    const project = await prisma.project.create({
      data: {
        id: `project_${nanoid()}`,
        name: "API Keys Test Project",
        slug: `--test-project-${ns}`,
        language: "typescript",
        framework: "other",
        apiKey: `sk-lw-${nanoid(48)}`,
        teamId: testTeam.id,
      },
    });
    testProjectId = project.id;

    const apiKeyService = ApiKeyService.create(prisma);
    const created = await apiKeyService.create({
      name: `api-keys-bootstrap-${nanoid(6)}`,
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
    bootstrapToken = created.token;
  });

  afterAll(async () => {
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
      const res = await app.request("/api/api-keys");
      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid token", async () => {
      const res = await app.request("/api/api-keys", {
        headers: { Authorization: "Bearer sk-lw-invalid_token" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/api-keys", () => {
    it("creates an API key and returns the token (shown once)", async () => {
      const res = await api.post("/api/api-keys", {
        name: "My API Token",
        bindings: [
          {
            role: "ADMIN",
            scopeType: "ORGANIZATION",
            scopeId: testOrganization.id,
          },
        ],
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.token).toMatch(/^sk-lw-/);
      expect(body.apiKey.id).toBeDefined();
      expect(body.apiKey.name).toBe("My API Token");
      expect(body.apiKey.createdAt).toBeDefined();
    });

    it("creates an API key with team-scoped binding", async () => {
      const res = await api.post("/api/api-keys", {
        name: "Team Scoped Token",
        bindings: [
          {
            role: "MEMBER",
            scopeType: "TEAM",
            scopeId: testTeam.id,
          },
        ],
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.token).toMatch(/^sk-lw-/);
    });

    it("creates an API key with expiration", async () => {
      const expiresAt = new Date(Date.now() + 86400000).toISOString();
      const res = await api.post("/api/api-keys", {
        name: "Expiring Token",
        expiresAt,
        bindings: [
          {
            role: "VIEWER",
            scopeType: "ORGANIZATION",
            scopeId: testOrganization.id,
          },
        ],
      });
      expect(res.status).toBe(201);
    });

    it("returns 422 when name is missing", async () => {
      const res = await api.post("/api/api-keys", {
        bindings: [
          {
            role: "ADMIN",
            scopeType: "ORGANIZATION",
            scopeId: testOrganization.id,
          },
        ],
      });
      expect(res.status).toBe(422);
    });

    it("returns 422 when bindings are empty", async () => {
      const res = await api.post("/api/api-keys", {
        name: "No Bindings",
        bindings: [],
      });
      expect(res.status).toBe(422);
    });

    it("returns 403 when scope does not belong to org", async () => {
      const res = await api.post("/api/api-keys", {
        name: "Bad Scope",
        bindings: [
          {
            role: "ADMIN",
            scopeType: "ORGANIZATION",
            scopeId: "nonexistent-org-id",
          },
        ],
      });
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/api-keys", () => {
    it("lists API keys for the authenticated user", async () => {
      const res = await api.get("/api/api-keys");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);

      const key = body.data[0];
      expect(key.id).toBeDefined();
      expect(key.name).toBeDefined();
      expect(key.roleBindings).toBeDefined();
    });

    it("does not include token in list response", async () => {
      const res = await api.get("/api/api-keys");
      const body = await res.json();
      for (const key of body.data) {
        expect(key).not.toHaveProperty("token");
        expect(key).not.toHaveProperty("hashedSecret");
        expect(key).not.toHaveProperty("lookupId");
      }
    });
  });

  describe("DELETE /api/api-keys/:id", () => {
    it("revokes an API key", async () => {
      const createRes = await api.post("/api/api-keys", {
        name: `Revoke Test ${nanoid(6)}`,
        bindings: [
          {
            role: "VIEWER",
            scopeType: "ORGANIZATION",
            scopeId: testOrganization.id,
          },
        ],
      });
      const created = await createRes.json();

      const res = await api.delete(`/api/api-keys/${created.apiKey.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it("returns 409 when revoking an already-revoked key", async () => {
      const createRes = await api.post("/api/api-keys", {
        name: `Double Revoke ${nanoid(6)}`,
        bindings: [
          {
            role: "VIEWER",
            scopeType: "ORGANIZATION",
            scopeId: testOrganization.id,
          },
        ],
      });
      const created = await createRes.json();

      await api.delete(`/api/api-keys/${created.apiKey.id}`);
      const res = await api.delete(`/api/api-keys/${created.apiKey.id}`);
      expect(res.status).toBe(409);
    });

    it("returns 404 for non-existent API key", async () => {
      const res = await api.delete("/api/api-keys/nonexistent-key-id");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/api-keys (service keys)", () => {
    it("creates a service key with full org access (no projectIds)", async () => {
      const res = await api.post("/api/api-keys", {
        keyType: "service",
        name: `Service Full ${nanoid(6)}`,
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.token).toMatch(/^sk-lw-/);
      expect(body.apiKey.id).toBeDefined();
    });

    it("creates a service key scoped to specific projects", async () => {
      const res = await api.post("/api/api-keys", {
        keyType: "service",
        name: `Service Scoped ${nanoid(6)}`,
        projectIds: [testProjectId],
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.token).toMatch(/^sk-lw-/);
    });

    it("returns 403 when project does not belong to org", async () => {
      const res = await api.post("/api/api-keys", {
        keyType: "service",
        name: "Bad Project",
        projectIds: ["project_nonexistent"],
      });
      expect(res.status).toBe(403);
    });
  });
});
