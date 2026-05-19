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

describe("Feature: Model Defaults REST API", () => {
  const ns = `model-defaults-api-${nanoid(8)}`;

  let testOrganization: Organization;
  let testTeam: Team;
  let testProjectId: string;
  let bootstrapToken: string;
  let userId: string;
  let configIdForUpdate: string;
  let configIdForDelete: string;

  const authHeaders = () => ({
    Authorization: `Bearer ${bootstrapToken}`,
    "X-Project-Id": testProjectId,
    "Content-Type": "application/json",
  });

  const api = {
    get: (path: string) => app.request(path, { headers: authHeaders() }),
    post: (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      }),
    put: (path: string, body: unknown) =>
      app.request(path, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(body),
      }),
    delete: (path: string) =>
      app.request(path, { method: "DELETE", headers: authHeaders() }),
  };

  beforeAll(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "Model Defaults Test Org", slug: `--test-org-${ns}` },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Model Defaults Test Team",
        slug: `--test-team-${ns}`,
        organizationId: testOrganization.id,
      },
    });

    const user = await prisma.user.create({
      data: { name: "Test User", email: `test-${ns}@example.com` },
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
        name: "Model Defaults Test Project",
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
      name: `model-defaults-bootstrap-${nanoid(6)}`,
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
    // Scope cleanup to test data only — repo-wide mass-delete protection
    // (src/utils/dbMassDeleteProtection.ts) rejects deleteMany with an
    // empty where. Filter by the scope rows we created for this org.
    await prisma.modelDefaultConfig
      .deleteMany({
        where: {
          scopes: {
            some: {
              OR: [
                { scopeType: "ORGANIZATION", scopeId: testOrganization.id },
                { scopeType: "TEAM", scopeId: testTeam.id },
                { scopeType: "PROJECT", scopeId: testProjectId },
              ],
            },
          },
        },
      })
      .catch(() => {});
    await prisma.roleBinding
      .deleteMany({ where: { organizationId: testOrganization.id } })
      .catch(() => {});
    await prisma.apiKey
      .deleteMany({ where: { userId } })
      .catch(() => {});
    await prisma.project.delete({ where: { id: testProjectId } }).catch(() => {});
    await prisma.teamUser
      .deleteMany({ where: { teamId: testTeam.id } })
      .catch(() => {});
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: testOrganization.id } })
      .catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.team.delete({ where: { id: testTeam.id } }).catch(() => {});
    await prisma.organization
      .delete({ where: { id: testOrganization.id } })
      .catch(() => {});
  });

  describe("when no auth header is provided", () => {
    it("returns 401", async () => {
      const headers = new Headers();
      headers.set("X-Project-Id", testProjectId);
      const res = await app.request("/api/model-defaults", { headers });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/model-defaults", () => {
    it("creates a config at PROJECT scope and returns its id", async () => {
      const res = await api.post("/api/model-defaults", {
        config: { DEFAULT: "openai/gpt-4o-mini" },
        scopes: [{ scopeType: "PROJECT", scopeId: testProjectId }],
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string };
      expect(body.id).toBeDefined();
      configIdForUpdate = body.id;
    });
  });

  describe("GET /api/model-defaults", () => {
    it("returns the configs visible to the project", async () => {
      const res = await api.get("/api/model-defaults");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        effective: Record<string, unknown>;
        configs: unknown[];
      };
      expect(body.effective).toBeDefined();
      expect(Array.isArray(body.configs)).toBe(true);
    });
  });

  describe("PUT /api/model-defaults/:id", () => {
    it("updates the config payload", async () => {
      const res = await api.put(`/api/model-defaults/${configIdForUpdate}`, {
        config: { DEFAULT: "openai/gpt-4o" },
      });
      expect(res.status).toBe(204);
    });
  });

  describe("DELETE /api/model-defaults/:id", () => {
    it("deletes the config", async () => {
      // Create a fresh row so the test doesn't depend on the previous it().
      const createRes = await api.post("/api/model-defaults", {
        config: { FAST: "openai/gpt-4o-mini" },
        scopes: [{ scopeType: "PROJECT", scopeId: testProjectId }],
      });
      const created = (await createRes.json()) as { id: string };
      configIdForDelete = created.id;
      const res = await api.delete(`/api/model-defaults/${configIdForDelete}`);
      expect(res.status).toBe(204);
    });
  });
});
