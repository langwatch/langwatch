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
import { PatService } from "~/server/pat/pat.service";
import { app } from "../[[...route]]/app";

describe("Feature: PATs REST API", () => {
  const ns = `pats-api-${nanoid(8)}`;

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
    delete: (path: string) =>
      app.request(path, {
        method: "DELETE",
        headers: authHeaders(),
      }),
  };

  beforeAll(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "PATs Test Org", slug: `--test-org-${ns}` },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "PATs Test Team",
        slug: `--test-team-${ns}`,
        organizationId: testOrganization.id,
      },
    });

    const user = await prisma.user.create({
      data: {
        name: "PATs Test User",
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

    const patService = PatService.create(prisma);
    const created = await patService.create({
      name: `pats-bootstrap-${nanoid(6)}`,
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

  afterAll(async () => {
    await prisma.roleBinding.deleteMany({
      where: { organizationId: testOrganization.id },
    }).catch(() => {});
    await prisma.personalAccessToken.deleteMany({
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
      const res = await app.request("/api/pats");
      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid PAT", async () => {
      const res = await app.request("/api/pats", {
        headers: { Authorization: "Bearer pat-lw-invalid_token" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/pats", () => {
    it("creates a PAT and returns the token (shown once)", async () => {
      const res = await api.post("/api/pats", {
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
      expect(body.token).toMatch(/^pat-lw-/);
      expect(body.pat.id).toBeDefined();
      expect(body.pat.name).toBe("My API Token");
      expect(body.pat.createdAt).toBeDefined();
    });

    it("creates a PAT with team-scoped binding", async () => {
      const res = await api.post("/api/pats", {
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
      expect(body.token).toMatch(/^pat-lw-/);
    });

    it("creates a PAT with expiration", async () => {
      const expiresAt = new Date(Date.now() + 86400000).toISOString();
      const res = await api.post("/api/pats", {
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
      const res = await api.post("/api/pats", {
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
      const res = await api.post("/api/pats", {
        name: "No Bindings",
        bindings: [],
      });
      expect(res.status).toBe(422);
    });

    it("returns 403 when scope does not belong to org", async () => {
      const res = await api.post("/api/pats", {
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

  describe("GET /api/pats", () => {
    it("lists PATs for the authenticated user", async () => {
      const res = await api.get("/api/pats");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);

      const pat = body.data[0];
      expect(pat.id).toBeDefined();
      expect(pat.name).toBeDefined();
      expect(pat.roleBindings).toBeDefined();
    });

    it("does not include token in list response", async () => {
      const res = await api.get("/api/pats");
      const body = await res.json();
      for (const pat of body.data) {
        expect(pat).not.toHaveProperty("token");
        expect(pat).not.toHaveProperty("hashedSecret");
        expect(pat).not.toHaveProperty("lookupId");
      }
    });
  });

  describe("DELETE /api/pats/:id", () => {
    it("revokes a PAT", async () => {
      const createRes = await api.post("/api/pats", {
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

      const res = await api.delete(`/api/pats/${created.pat.id}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it("returns 409 when revoking an already-revoked PAT", async () => {
      const createRes = await api.post("/api/pats", {
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

      await api.delete(`/api/pats/${created.pat.id}`);
      const res = await api.delete(`/api/pats/${created.pat.id}`);
      expect(res.status).toBe(409);
    });

    it("returns 404 for non-existent PAT", async () => {
      const res = await api.delete("/api/pats/nonexistent-pat-id");
      expect(res.status).toBe(404);
    });
  });
});
