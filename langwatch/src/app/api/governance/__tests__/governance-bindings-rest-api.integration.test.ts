/**
 * @vitest-environment node
 *
 * REST integration coverage for /api/governance/user-ingestion-bindings.
 * The binding routes require a human caller (PAT bound to a User) so
 * the cross-bind invariant `Project.ownerUserId === callerUserId` can
 * resolve — legacy project tokens 403 with human_caller_required.
 *
 * Setup builds a real PAT row + RoleBindings via PatService so the
 * Bearer pat-lw-... + X-Project-Id auth path resolves end-to-end and
 * the PAT ceiling check (organization:view) passes.
 *
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 *       specs/ai-gateway/governance/user-ingestion-binding-lifecycle.feature
 *       specs/ai-gateway/governance/template-cross-bind-guard.feature
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
  delete: (path: string) => Response | Promise<Response>;
}

describe("Feature: User-Ingestion-Bindings REST API", () => {
  let testOrganization: Organization;
  let testTeam: Team;
  let testUser: User;
  let testCallerProject: Project;
  let testPersonalProject: Project;
  let patToken: string;
  let testTemplateId: string;
  let api: ApiHelpers;

  const platformIds: string[] = [];
  const orgIds: string[] = [];
  const userIds: string[] = [];

  const headers = () => ({
    Authorization: `Bearer ${patToken}`,
    "X-Project-Id": testCallerProject.id,
    "Content-Type": "application/json",
  });

  beforeEach(async () => {
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: vi.fn().mockResolvedValue(FREE_PLAN) as unknown as
          PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyPlanLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
    });

    const ns = nanoid(8);
    testOrganization = await prisma.organization.create({
      data: { name: `Bindings Org ${ns}`, slug: `bindings-${ns}` },
    });
    orgIds.push(testOrganization.id);

    testTeam = await prisma.team.create({
      data: {
        name: `Bindings Team ${ns}`,
        slug: `bindings-team-${ns}`,
        organizationId: testOrganization.id,
      },
    });

    // Caller's main project — the API key bound to this gives the Hono
    // routes their organizationId via orgIdForProject(project.id).
    const callerProjectInput = (projectFactory.build as unknown as (
      override: Partial<Project>,
    ) => Project)({ slug: nanoid() });
    testCallerProject = await prisma.project.create({
      data: {
        ...callerProjectInput,
        teamId: testTeam.id,
      } as unknown as Parameters<
        typeof prisma.project.create
      >[0]["data"],
    });

    testUser = await prisma.user.create({
      data: { email: `bindings-${ns}@example.com`, name: `Bindings User ${ns}` },
    });
    userIds.push(testUser.id);

    await prisma.organizationUser.create({
      data: {
        userId: testUser.id,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.teamUser.create({
      data: {
        userId: testUser.id,
        teamId: testTeam.id,
        role: TeamUserRole.ADMIN,
      },
    });

    // Personal team + personal project for the test user — required by
    // the cross-bind invariant (`Project.ownerUserId === callerUserId`
    // AND `isPersonal=true`). PersonalWorkspaceService normally creates
    // these together; we mirror its shape directly here.
    const personalTeam = await prisma.team.create({
      data: {
        name: `${testUser.name} (Personal)`,
        slug: `personal-${ns}`,
        organizationId: testOrganization.id,
        isPersonal: true,
        ownerUserId: testUser.id,
      },
    });
    const personalProjectInput = (projectFactory.build as unknown as (
      override: Partial<Project>,
    ) => Project)({ slug: `personal-${ns}` });
    testPersonalProject = await prisma.project.create({
      data: {
        ...personalProjectInput,
        teamId: personalTeam.id,
        isPersonal: true,
        ownerUserId: testUser.id,
      } as unknown as Parameters<
        typeof prisma.project.create
      >[0]["data"],
    });

    // PatService.assertBindingsWithinCeiling reads the creator's own
    // RoleBindings (NOT the legacy OrganizationUser.role) — without this
    // grant, PatService.create rejects with PatScopeViolationError.
    await prisma.roleBinding.create({
      data: {
        organizationId: testOrganization.id,
        userId: testUser.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: testOrganization.id,
      },
    });

    // PAT scoped MEMBER at org so the ceiling stays tight; MEMBER carries
    // organization:view, which is the permission the binding routes gate on.
    const apiKeyService = ApiKeyService.create(prisma);
    const apiKeyResult = await apiKeyService.create({
      name: `bindings-pat-${ns}`,
      userId: testUser.id,
      organizationId: testOrganization.id,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: testOrganization.id,
        },
      ],
    });
    patToken = apiKeyResult.token;

    // Platform-published template the test caller can install against.
    const platformId = `tmpl-bindings-${nanoid(8)}`;
    platformIds.push(platformId);
    await prisma.ingestionTemplate.create({
      data: {
        id: platformId,
        organizationId: null,
        slug: `bindings_platform_${nanoid(6)}`,
        sourceType: "claude_code",
        displayName: "Platform Template for Bindings",
        ottlRules: 'set(attributes["langwatch.cost.usd"], 0)',
        platformPublished: true,
        enabled: true,
      },
    });
    testTemplateId = platformId;

    api = {
      get: (path) => app.request(path, { headers: headers() }),
      post: (path, body) =>
        app.request(path, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(body),
        }),
      delete: (path) =>
        app.request(path, { method: "DELETE", headers: headers() }),
    };
  });

  afterEach(async () => {
    await prisma.userIngestionBinding.deleteMany({
      where: { userId: testUser?.id },
    });
    if (platformIds.length > 0) {
      await prisma.ingestionTemplate.deleteMany({
        where: { id: { in: platformIds } },
      });
      platformIds.length = 0;
    }
    await prisma.auditLog.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.roleBinding.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.apiKey.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.teamUser
      .deleteMany({ where: { userId: { in: userIds } } })
      .catch(() => undefined);
    // dbOrganizationIdProtection middleware requires organizationId in
    // the WHERE clause for OrganizationUser writes.
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: { in: orgIds } } })
      .catch(() => undefined);
    if (testPersonalProject?.id) {
      await prisma.project
        .delete({ where: { id: testPersonalProject.id } })
        .catch(() => undefined);
    }
    if (testCallerProject?.id) {
      await prisma.project
        .delete({ where: { id: testCallerProject.id } })
        .catch(() => undefined);
    }
    await prisma.team
      .deleteMany({ where: { organizationId: { in: orgIds } } })
      .catch(() => undefined);
    for (const id of userIds) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    userIds.length = 0;
    for (const id of orgIds) {
      await prisma.organization.delete({ where: { id } }).catch(() => undefined);
    }
    orgIds.length = 0;
  });

  describe("Authentication + caller-shape gates", () => {
    it("returns 401 with no auth", async () => {
      const res = await app.request("/api/governance/user-ingestion-bindings");
      expect(res.status).toBe(401);
    });

    it("returns 403 when called with a legacy project token (human_caller_required)", async () => {
      const res = await app.request(
        "/api/governance/user-ingestion-bindings",
        { headers: { "X-Auth-Token": testCallerProject.apiKey } },
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("human_caller_required");
    });
  });

  describe("GET /user-ingestion-bindings", () => {
    it("returns the caller's own bindings (initially empty)", async () => {
      const res = await api.get("/api/governance/user-ingestion-bindings");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });
  });

  describe("POST /user-ingestion-bindings (install)", () => {
    it("creates a binding, returns the plaintext token once, and audit-stamps surface=hono", async () => {
      const res = await api.post("/api/governance/user-ingestion-bindings", {
        template_id: testTemplateId,
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        binding: {
          id: string;
          user_id: string;
          template_id: string;
          personal_project_id: string;
          binding_access_token_prefix: string;
        };
        token: string;
      };
      expect(body.binding.template_id).toBe(testTemplateId);
      expect(body.binding.user_id).toBe(testUser.id);
      expect(body.binding.personal_project_id).toBe(testPersonalProject.id);
      expect(body.token).toMatch(/^ik-lw-[a-z0-9]+$/i);
      expect(body.binding.binding_access_token_prefix).toBe(
        body.token.slice(0, body.binding.binding_access_token_prefix.length),
      );

      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: testOrganization.id,
          action: "gateway.user_ingestion_binding.installed",
          targetId: body.binding.id,
        },
      });
      expect((audit?.metadata as { surface?: string } | null)?.surface).toBe(
        "hono",
      );
    });

    it("returns 409 when an active binding already exists for the same template", async () => {
      const first = await api.post(
        "/api/governance/user-ingestion-bindings",
        { template_id: testTemplateId },
      );
      expect(first.status).toBe(201);

      const dup = await api.post("/api/governance/user-ingestion-bindings", {
        template_id: testTemplateId,
      });
      expect(dup.status).toBe(409);
      const body = (await dup.json()) as { error: { code: string } };
      expect(body.error.code).toBe("binding_already_exists");
    });

    it("returns 404 for a nonexistent template", async () => {
      const res = await api.post("/api/governance/user-ingestion-bindings", {
        template_id: `nope-${nanoid(6)}`,
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("ingestion_template_not_found");
    });
  });

  describe("DELETE /user-ingestion-bindings/:id", () => {
    it("soft-archives the binding and audit-stamps surface=hono", async () => {
      const create = await api.post(
        "/api/governance/user-ingestion-bindings",
        { template_id: testTemplateId },
      );
      const created = (await create.json()) as { binding: { id: string } };

      const del = await api.delete(
        `/api/governance/user-ingestion-bindings/${created.binding.id}`,
      );
      expect(del.status).toBe(200);
      const body = (await del.json()) as { uninstalled: boolean };
      expect(body.uninstalled).toBe(true);

      const list = await api.get("/api/governance/user-ingestion-bindings");
      const afterList = (await list.json()) as { data: unknown[] };
      expect(afterList.data).toEqual([]);

      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: testOrganization.id,
          action: "gateway.user_ingestion_binding.uninstalled",
          targetId: created.binding.id,
        },
      });
      expect((audit?.metadata as { surface?: string } | null)?.surface).toBe(
        "hono",
      );
    });

    it("returns 404 for a nonexistent binding", async () => {
      const res = await api.delete(
        `/api/governance/user-ingestion-bindings/missing-${nanoid(6)}`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /user-ingestion-bindings/:id/rotate", () => {
    it("issues a fresh token, invalidates the previous, and audit-stamps surface=hono", async () => {
      const create = await api.post(
        "/api/governance/user-ingestion-bindings",
        { template_id: testTemplateId },
      );
      const created = (await create.json()) as {
        binding: { id: string; binding_access_token_prefix: string };
        token: string;
      };

      const rotate = await api.post(
        `/api/governance/user-ingestion-bindings/${created.binding.id}/rotate`,
        {},
      );
      expect(rotate.status).toBe(200);
      const rotated = (await rotate.json()) as {
        binding: { id: string; binding_access_token_prefix: string };
        token: string;
      };
      expect(rotated.token).not.toBe(created.token);
      expect(rotated.binding.binding_access_token_prefix).not.toBe(
        created.binding.binding_access_token_prefix,
      );

      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: testOrganization.id,
          action: "gateway.user_ingestion_binding.token_rotated",
          targetId: created.binding.id,
        },
      });
      expect((audit?.metadata as { surface?: string } | null)?.surface).toBe(
        "hono",
      );
    });
  });
});
