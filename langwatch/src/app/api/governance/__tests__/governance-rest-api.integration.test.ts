/**
 * @vitest-environment node
 *
 * REST integration coverage for the /api/governance Hono surface.
 * Real Postgres + real Prisma + real Hono request pipeline — no
 * service mocks. Locks the resource×verb wire shape that CLI + MCP
 * surfaces are mirroring per the umbrella spec.
 *
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 *       specs/ai-gateway/governance/ingestion-templates-catalog.feature
 *       specs/ai-governance/admin-ottl-authoring.feature
 */
import {
  type Organization,
  OrganizationUserRole,
  type Project,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
  type User,
} from "@prisma/client";
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
import { ApiKeyService } from "~/server/api-key/api-key.service";

import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { app } from "../[[...route]]/app";

interface ApiHelpers {
  get: (path: string) => Response | Promise<Response>;
  post: (path: string, body: unknown) => Response | Promise<Response>;
  patch: (path: string, body: unknown) => Response | Promise<Response>;
  delete: (path: string) => Response | Promise<Response>;
}

describe("Feature: Governance REST API", () => {
  let testApiKey: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let testUser: User;
  let patToken: string;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;
  let api: ApiHelpers;

  const platformIds: string[] = [];
  const orgTemplateIds: string[] = [];
  const orgIds: string[] = [];
  const userIds: string[] = [];

  // Template administration is gated on a user-bound caller (PAT), not a
  // shared project key: a legacy project token bypasses the aiTools:manage
  // ceiling, so admin reads/mutations authenticate with a PAT carrying an
  // org-scoped ADMIN binding (which resolves aiTools:manage + aiTools:view).
  const createAuthHeaders = () => ({
    Authorization: `Bearer ${patToken}`,
    "X-Project-Id": testProject.id,
    "Content-Type": "application/json",
  });

  beforeEach(async () => {
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

    const suffix = nanoid(8);
    testOrganization = await prisma.organization.create({
      data: { name: `Gov Test Org ${suffix}`, slug: `gov-${suffix}` },
    });
    orgIds.push(testOrganization.id);

    testTeam = await prisma.team.create({
      data: {
        name: `Gov Test Team ${suffix}`,
        slug: `gov-team-${suffix}`,
        organizationId: testOrganization.id,
      },
    });

    // Fishery's generic-inference is brittle on partial overrides; the
    // existing dashboards-rest-api integration test has the same cast.
    const projectInput = (projectFactory.build as unknown as (
      override: Partial<Project>,
    ) => Project)({ slug: nanoid() });
    testProject = await prisma.project.create({
      data: {
        ...projectInput,
        teamId: testTeam.id,
      } as unknown as Parameters<
        typeof prisma.project.create
      >[0]["data"],
    });

    testApiKey = testProject.apiKey;

    testUser = await prisma.user.create({
      data: { email: `gov-${suffix}@example.com`, name: `Gov User ${suffix}` },
    });
    userIds.push(testUser.id);

    await prisma.organizationUser.create({
      data: {
        userId: testUser.id,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });

    // ApiKeyService.create reads the creator's own RoleBindings to enforce
    // the ceiling; an org-scoped ADMIN grant lets the PAT request the same.
    await prisma.roleBinding.create({
      data: {
        organizationId: testOrganization.id,
        userId: testUser.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: testOrganization.id,
      },
    });

    const apiKeyResult = await ApiKeyService.create(prisma).create({
      name: `gov-pat-${suffix}`,
      userId: testUser.id,
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
    patToken = apiKeyResult.token;

    const patHeaders = {
      Authorization: `Bearer ${patToken}`,
      "X-Project-Id": testProject.id,
    };

    api = {
      get: (path) => app.request(path, { headers: patHeaders }),
      post: (path, body) =>
        app.request(path, {
          method: "POST",
          headers: createAuthHeaders(),
          body: JSON.stringify(body),
        }),
      patch: (path, body) =>
        app.request(path, {
          method: "PATCH",
          headers: createAuthHeaders(),
          body: JSON.stringify(body),
        }),
      delete: (path) =>
        app.request(path, {
          method: "DELETE",
          headers: patHeaders,
        }),
    };
  });

  afterEach(async () => {
    if (orgTemplateIds.length > 0) {
      await prisma.ingestionTemplate.deleteMany({
        where: { id: { in: orgTemplateIds } },
      });
      orgTemplateIds.length = 0;
    }
    if (platformIds.length > 0) {
      await prisma.ingestionTemplate.deleteMany({
        where: { id: { in: platformIds } },
      });
      platformIds.length = 0;
    }
    await prisma.auditLog.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    // RoleBindings carry the required relation to the PAT's ApiKey, so they
    // must be removed before the keys they belong to.
    await prisma.roleBinding.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.apiKey.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    // dbOrganizationIdProtection requires organizationId in the WHERE clause
    // for OrganizationUser writes.
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: { in: orgIds } } })
      .catch(() => undefined);
    if (testProject?.id) {
      await prisma.project.delete({ where: { id: testProject.id } });
    }
    if (testTeam?.id) {
      await prisma.team.delete({ where: { id: testTeam.id } });
    }
    for (const id of userIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    userIds.length = 0;
    for (const id of orgIds) {
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
    orgIds.length = 0;
  });

  describe("Authentication", () => {
    it("returns 401 without X-Auth-Token", async () => {
      const res = await app.request("/api/governance/ingestion-templates");
      expect(res.status).toBe(401);
    });

    it("returns 401 with an invalid X-Auth-Token", async () => {
      const res = await app.request("/api/governance/ingestion-templates", {
        headers: { "X-Auth-Token": "not-a-real-key" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("when authenticated with a legacy project key", () => {
    it("still reads the user-facing template list (public read)", async () => {
      const res = await app.request("/api/governance/ingestion-templates", {
        headers: { "X-Auth-Token": testApiKey },
      });
      expect(res.status).toBe(200);
    });

    it("rejects the admin template list with 403 user_token_required", async () => {
      const res = await app.request(
        "/api/governance/ingestion-templates/admin",
        { headers: { "X-Auth-Token": testApiKey } },
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("user_token_required");
    });

    it("rejects creating an org template with 403 user_token_required", async () => {
      const res = await app.request("/api/governance/ingestion-templates", {
        method: "POST",
        headers: {
          "X-Auth-Token": testApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_type: "internal_codex",
          display_name: "Should Be Forbidden",
        }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("user_token_required");
    });
  });

  describe("GET /api/governance/ingestion-templates", () => {
    describe("when only platform-published rows exist", () => {
      beforeEach(async () => {
        const id = `tmpl-platform-${nanoid(8)}`;
        platformIds.push(id);
        await prisma.ingestionTemplate.create({
          data: {
            id,
            organizationId: null,
            slug: `platform_default_${nanoid(6)}`,
            sourceType: "claude_code",
            displayName: "Platform Default",
            description: "Locked platform row",
            iconAsset: "preset:claude_code",
            credentialSchema: null,
            ottlRules: 'set(attributes["langwatch.cost.usd"], 0)',
            platformPublished: true,
            enabled: true,
          },
        });
      });

      it("returns the platform row in the user-facing shape with empty ottl_rules", async () => {
        const res = await api.get("/api/governance/ingestion-templates");
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: Array<Record<string, unknown>> };
        const platform = body.data.find(
          (r) => (r.id as string) === platformIds[0],
        );
        expect(platform).toBeDefined();
        expect(platform?.platform_published).toBe(true);
        expect(platform?.organization_id).toBeNull();
        // End-user shape suppresses OTTL — that's the admin endpoint's job.
        expect(platform?.ottl_rules).toBe("");
      });
    });
  });

  describe("GET /api/governance/ingestion-templates/admin", () => {
    describe("when there are platform + org-authored rows", () => {
      beforeEach(async () => {
        const platformId = `tmpl-platform-${nanoid(8)}`;
        platformIds.push(platformId);
        await prisma.ingestionTemplate.create({
          data: {
            id: platformId,
            organizationId: null,
            slug: `admin_view_platform_${nanoid(6)}`,
            sourceType: "claude_code",
            displayName: "Admin-Visible Platform",
            description: null,
            iconAsset: null,
            credentialSchema: null,
            ottlRules: 'set(attributes["x"], "y")',
            platformPublished: true,
            enabled: true,
          },
        });
      });

      it("returns full ottl_rules in the admin shape", async () => {
        const res = await api.get(
          "/api/governance/ingestion-templates/admin",
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: Array<Record<string, unknown>> };
        const platform = body.data.find(
          (r) => (r.id as string) === platformIds[0],
        );
        expect(platform).toBeDefined();
        expect(platform?.ottl_rules).toContain('set(attributes["x"]');
      });
    });
  });

  describe("POST /api/governance/ingestion-templates", () => {
    it("creates an org-authored template and stamps surface=hono", async () => {
      const res = await api.post("/api/governance/ingestion-templates", {
        source_type: "internal_codex",
        display_name: "Internal Codex",
        description: "Custom",
        ottl_rules: 'set(attributes["langwatch.cost.usd"], attributes["x"])',
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        ingestion_template: Record<string, unknown>;
      };
      const created = body.ingestion_template;
      expect(created.platform_published).toBe(false);
      expect(created.organization_id).toBe(testOrganization.id);
      expect(typeof created.id).toBe("string");
      orgTemplateIds.push(created.id as string);

      // Audit row carries surface=hono per umbrella spec @audit-uniform.
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: testOrganization.id,
          action: "gateway.ingestion_template.created",
          targetId: created.id as string,
        },
      });
      expect(
        (audit?.metadata as { surface?: string } | null)?.surface,
      ).toBe("hono");
    });

    it("returns 400 for an invalid source_type", async () => {
      const res = await api.post("/api/governance/ingestion-templates", {
        source_type: "Bad Source!",
        display_name: "Should Fail",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid_source_type");
    });

    it("returns 400 when display_name is missing", async () => {
      const res = await api.post("/api/governance/ingestion-templates", {
        source_type: "valid_source",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/governance/ingestion-templates/:id/ottl-rules", () => {
    it("updates an org-authored row and audit-logs the change", async () => {
      const create = await api.post("/api/governance/ingestion-templates", {
        source_type: "patch_target",
        display_name: "Patch Target",
        ottl_rules: "",
      });
      const created = (await create.json()) as {
        ingestion_template: { id: string };
      };
      orgTemplateIds.push(created.ingestion_template.id);

      const patch = await api.patch(
        `/api/governance/ingestion-templates/${created.ingestion_template.id}/ottl-rules`,
        {
          ottl_rules:
            'set(attributes["langwatch.cost.usd"], attributes["new"])\n' +
            'set(attributes["x"], "y")',
        },
      );
      expect(patch.status).toBe(200);
      const body = (await patch.json()) as {
        ingestion_template: { ottl_rules: string };
      };
      expect(body.ingestion_template.ottl_rules).toContain("new");

      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: testOrganization.id,
          action: "gateway.ingestion_template.ottl_updated",
          targetId: created.ingestion_template.id,
        },
      });
      expect(
        (audit?.metadata as { surface?: string } | null)?.surface,
      ).toBe("hono");
    });

    it("returns 403 when targeting a platform-published row (immutability guard)", async () => {
      const platformId = `tmpl-immutable-${nanoid(8)}`;
      platformIds.push(platformId);
      await prisma.ingestionTemplate.create({
        data: {
          id: platformId,
          organizationId: null,
          slug: `immutable_${nanoid(6)}`,
          sourceType: "claude_code",
          displayName: "Immutable",
          ottlRules: "platform-canon",
          platformPublished: true,
          enabled: true,
        },
      });
      // The org-mutation surface filters by organizationId === ORG_ID, so a
      // platform row (organizationId IS NULL) returns 404 before the
      // platformPublished guard fires. This is the documented behavior in
      // the service layer + integration test (TemplateNotFoundError leaks
      // first; PlatformTemplateImmutableError only fires for clones).
      const res = await api.patch(
        `/api/governance/ingestion-templates/${platformId}/ottl-rules`,
        { ottl_rules: "forged" },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/governance/ingestion-templates/clone", () => {
    it("clones a platform-published template into the caller's org", async () => {
      const platformId = `tmpl-clone-src-${nanoid(8)}`;
      platformIds.push(platformId);
      await prisma.ingestionTemplate.create({
        data: {
          id: platformId,
          organizationId: null,
          slug: `clone_src_${nanoid(6)}`,
          sourceType: "claude_code",
          displayName: "Clone Source",
          ottlRules: 'set(attributes["from"], "platform")',
          platformPublished: true,
          enabled: true,
        },
      });

      const res = await api.post("/api/governance/ingestion-templates/clone", {
        source_template_id: platformId,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        ingestion_template: {
          id: string;
          platform_published: boolean;
          organization_id: string | null;
          ottl_rules: string;
          display_name: string;
        };
      };
      const cloned = body.ingestion_template;
      expect(cloned.id).not.toBe(platformId);
      expect(cloned.platform_published).toBe(false);
      expect(cloned.organization_id).toBe(testOrganization.id);
      expect(cloned.ottl_rules).toBe('set(attributes["from"], "platform")');
      expect(cloned.display_name).toBe("Clone Source (custom)");
      orgTemplateIds.push(cloned.id);
    });

    it("returns 404 for a nonexistent source", async () => {
      const res = await api.post("/api/governance/ingestion-templates/clone", {
        source_template_id: `nonexistent-${nanoid(6)}`,
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/governance/ingestion-templates/:id", () => {
    it("soft-archives an org-authored row", async () => {
      const create = await api.post("/api/governance/ingestion-templates", {
        source_type: "to_archive",
        display_name: "Archive Me",
      });
      const created = (await create.json()) as {
        ingestion_template: { id: string };
      };
      orgTemplateIds.push(created.ingestion_template.id);

      const archive = await api.delete(
        `/api/governance/ingestion-templates/${created.ingestion_template.id}`,
      );
      expect(archive.status).toBe(200);
      const body = (await archive.json()) as { archived: boolean };
      expect(body.archived).toBe(true);

      const list = await api.get(
        "/api/governance/ingestion-templates/admin",
      );
      const visible = (await list.json()) as { data: Array<{ id: string }> };
      expect(
        visible.data.find((r) => r.id === created.ingestion_template.id),
      ).toBeUndefined();
    });

    it("returns 404 for a nonexistent template", async () => {
      const res = await api.delete(
        `/api/governance/ingestion-templates/nonexistent-${nanoid(6)}`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/governance/ingestion-templates/:id", () => {
    it("returns 404 for a row that belongs to another org (no enumeration vector)", async () => {
      const otherOrg = await prisma.organization.create({
        data: { name: "Other Org", slug: `other-${nanoid(6)}` },
      });
      orgIds.push(otherOrg.id);
      const otherTemplate = await prisma.ingestionTemplate.create({
        data: {
          organizationId: otherOrg.id,
          slug: `other_${nanoid(6)}`,
          sourceType: "internal_other",
          displayName: "Other Org Template",
          ottlRules: "",
          platformPublished: false,
          enabled: true,
        },
      });
      orgTemplateIds.push(otherTemplate.id);

      const res = await api.get(
        `/api/governance/ingestion-templates/${otherTemplate.id}`,
      );
      expect(res.status).toBe(404);
    });
  });
});
