/**
 * @vitest-environment node
 *
 * Integration regression for the RBAC drift Ariana caught at 1d5ddb1fe:
 * a user has `OrganizationUser.role = MEMBER` but ALSO holds an
 * ORGANIZATION-scoped ADMIN `RoleBinding`. The page-guard hook
 * (`useOrganizationTeamProject().organizationRole`) reads
 * `organization.members[0].role`, so the stale legacy column shadows
 * the fresh binding and `withPermissionGuard("organization:manage")`
 * denies access — even though backend RBAC paths
 * (`resolveOrganizationPermission`, `requirePatPermission`) already
 * honor the binding correctly.
 *
 * The narrow fix in `organization.getAll` promotes the exposed
 * `members[0].role` to `ADMIN` whenever `isOrgAdminViaBinding === true`,
 * so the existing frontend hook keeps working unchanged. Backend
 * contract is unaffected — Hono routes (Lane-S) confirmed independent
 * by sergey at 8fffad4ad.
 *
 * Spec scope: page-guard SSR only (per master_orchestrator). No wider
 * RBAC model unification in this PR.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { createTestApp } from "../../../app-layer/presets";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { OrganizationService } from "../../../app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "../../../app-layer/organizations/repositories/organization.prisma.repository";
import { PromptTagRepository } from "../../../prompt-config/repositories/prompt-tag.repository";
import { traced } from "../../../app-layer/tracing";

describe("organization.getAll — admin-via-binding promotion of legacy role", () => {
  const testNamespace = `admin-promote-${nanoid(8)}`;
  let organizationId: string;
  let adminUserId: string;
  let plainMemberUserId: string;
  let adminCaller: ReturnType<typeof appRouter.createCaller>;
  let plainMemberCaller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: {
        name: "Admin Promotion Test Org",
        slug: `--test-admin-promote-${testNamespace}`,
      },
    });
    organizationId = organization.id;

    const adminUser = await prisma.user.create({
      data: {
        email: `admin-promote-${testNamespace}@test.com`,
        name: "Stale-Member Admin",
      },
    });
    adminUserId = adminUser.id;

    const plainMemberUser = await prisma.user.create({
      data: {
        email: `plain-member-${testNamespace}@test.com`,
        name: "Plain Member",
      },
    });
    plainMemberUserId = plainMemberUser.id;

    // Drift state under test: legacy column says MEMBER, RoleBinding says ADMIN.
    await prisma.organizationUser.create({
      data: {
        userId: adminUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.roleBinding.create({
      data: {
        id: `rb-admin-${nanoid(8)}`,
        organizationId,
        userId: adminUserId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });

    // Control case: a user with no binding promotion — legacy MEMBER stays MEMBER.
    await prisma.organizationUser.create({
      data: {
        userId: plainMemberUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });

    globalForApp.__langwatch_app = createTestApp({
      organizations: traced(
        new OrganizationService(
          new PrismaOrganizationRepository(prisma),
          new PromptTagRepository(prisma),
        ),
        "OrganizationService",
      ),
    });

    adminCaller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: adminUserId }, expires: "1" },
      }),
    );
    plainMemberCaller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: plainMemberUserId }, expires: "1" },
      }),
    );
  });

  afterAll(async () => {
    await resetApp();
    const safeDelete = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch {
        /* noop */
      }
    };
    await safeDelete(() =>
      prisma.user.deleteMany({
        where: {
          email: {
            in: [
              `admin-promote-${testNamespace}@test.com`,
              `plain-member-${testNamespace}@test.com`,
            ],
          },
        },
      }),
    );
    if (organizationId) {
      await safeDelete(() =>
        prisma.roleBinding.deleteMany({ where: { organizationId } }),
      );
      await safeDelete(() =>
        prisma.organizationUser.deleteMany({ where: { organizationId } }),
      );
      await safeDelete(() =>
        prisma.organization.deleteMany({ where: { id: organizationId } }),
      );
    }
  });

  describe("given a user with stale OrganizationUser.role=MEMBER + fresh ORG-scoped ADMIN RoleBinding", () => {
    it("exposes members[0].role === ADMIN so the frontend hook honors the binding", async () => {
      const result = await adminCaller.organization.getAll({});
      const org = result.find((o) => o.id === organizationId);
      expect(org).toBeDefined();
      expect(org!.members).toHaveLength(1);
      expect(org!.members[0]?.role).toBe(OrganizationUserRole.ADMIN);
      expect(org!.members[0]?.userId).toBe(adminUserId);
    });
  });

  describe("given a user with no admin RoleBinding (control case)", () => {
    it("preserves the legacy OrganizationUser.role value (no promotion)", async () => {
      const result = await plainMemberCaller.organization.getAll({});
      const org = result.find((o) => o.id === organizationId);
      expect(org).toBeDefined();
      expect(org!.members[0]?.role).toBe(OrganizationUserRole.MEMBER);
    });
  });
});
