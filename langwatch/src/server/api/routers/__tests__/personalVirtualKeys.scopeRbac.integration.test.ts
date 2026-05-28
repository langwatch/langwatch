/**
 * @vitest-environment node
 *
 * Scope-aware RBAC for the personal-VK read path. Real Postgres test
 * container, no mocks.
 *
 * Contract (specs/ai-gateway/governance/vk-scope-rbac.feature, personal-VK
 * block):
 *   - Any org member can lazy-mint + list their OWN personal keys with no
 *     explicit grant (principal-user match bypasses virtualKeys:view).
 *   - Viewing ANOTHER user's personal keys requires
 *     virtualKeys:viewOtherPersonal; org admins gain it via the ADMIN role
 *     template at runtime (no per-org backfill), plain members never do.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../../db";
import { appRouter } from "../../root";
import type { Permission } from "../../rbac";
import { createInnerTRPCContext } from "../../trpc";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";

type Caller = ReturnType<typeof appRouter.createCaller>;

describe("personalVirtualKeys — scope-aware RBAC", () => {
  const ns = `pvkrbac-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const TEAM_ID = `team-${ns}`;
  const PROJECT_ID = `proj-${ns}`;
  const MODEL_PROVIDER_ID = `mp-${ns}`;
  const ROUTING_POLICY_ID = `rp-${ns}`;

  const LEO = `usr-leo-${ns}`;
  const MAYA = `usr-maya-${ns}`;
  const SWEEPER = `usr-sweeper-${ns}`;
  const ORG_ADMIN = `usr-admin-${ns}`;
  const PLAIN = `usr-plain-${ns}`;

  function callerFor(userId: string): Caller {
    return appRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id: userId, email: `${userId}@example.com`, name: userId },
          expires: new Date(Date.now() + 3_600_000).toISOString(),
        } as any,
      }),
    );
  }

  async function seedCustomRole(userId: string, perms: Permission[]) {
    const roleId = `crole-${userId}`;
    await prisma.customRole.create({
      data: { id: roleId, organizationId: ORG_ID, name: roleId, permissions: perms },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId,
        role: TeamUserRole.CUSTOM,
        customRoleId: roleId,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });
  }

  async function seedPersonalVk(principalUserId: string, name: string): Promise<string> {
    const vk = await prisma.virtualKey.create({
      data: {
        organizationId: ORG_ID,
        name,
        description: "Personal virtual key",
        hashedSecret: `hash-${name}-${ns}`,
        displayPrefix: "vk-lw-SEED",
        principalUserId,
        createdById: principalUserId,
        config: {},
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });
    return vk.id;
  }

  let leoVk: string;
  let mayaVk: string;

  beforeAll(async () => {
    await startTestContainers();
    await prisma.organization.create({
      data: { id: ORG_ID, name: ns, slug: ORG_ID },
    });
    await prisma.user.createMany({
      data: [LEO, MAYA, SWEEPER, ORG_ADMIN, PLAIN].map((id) => ({
        id,
        email: `${id}@example.com`,
        name: id,
      })),
    });
    await prisma.organizationUser.createMany({
      data: [
        { organizationId: ORG_ID, userId: LEO, role: OrganizationUserRole.MEMBER },
        { organizationId: ORG_ID, userId: MAYA, role: OrganizationUserRole.MEMBER },
        { organizationId: ORG_ID, userId: SWEEPER, role: OrganizationUserRole.MEMBER },
        { organizationId: ORG_ID, userId: ORG_ADMIN, role: OrganizationUserRole.ADMIN },
        { organizationId: ORG_ID, userId: PLAIN, role: OrganizationUserRole.MEMBER },
      ],
    });
    await prisma.team.create({
      data: { id: TEAM_ID, name: TEAM_ID, slug: `team-${ns}`, organizationId: ORG_ID },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: PROJECT_ID,
        slug: `proj-${ns}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-${ns}`,
      },
    });

    // maya: virtualKeys:view but NOT viewOtherPersonal.
    await seedCustomRole(MAYA, ["virtualKeys:view"]);
    // sweeper: explicit viewOtherPersonal via a custom role.
    await seedCustomRole(SWEEPER, ["virtualKeys:viewOtherPersonal"]);
    // org admin: an ORGANIZATION-scoped ADMIN RoleBinding, no explicit
    // viewOtherPersonal perm — proving the ADMIN template grants it at
    // runtime (the migration contract).
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: ORG_ADMIN,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });

    // Default routing policy + provider so issuePersonal can mint.
    await prisma.modelProvider.create({
      data: {
        id: MODEL_PROVIDER_ID,
        name: MODEL_PROVIDER_ID,
        provider: "openai",
        enabled: true,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });
    await prisma.routingPolicy.create({
      data: {
        id: ROUTING_POLICY_ID,
        organizationId: ORG_ID,
        name: ROUTING_POLICY_ID,
        isDefault: true,
        modelProviderIds: [MODEL_PROVIDER_ID],
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });

    leoVk = await seedPersonalVk(LEO, "leo-default");
    mayaVk = await seedPersonalVk(MAYA, "maya-default");
  }, 60_000);

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.routingPolicy.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.modelProviderScope.deleteMany({
      where: { modelProviderId: MODEL_PROVIDER_ID },
    });
    await prisma.modelProvider.deleteMany({ where: { id: MODEL_PROVIDER_ID } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.customRole.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.teamUser.deleteMany({ where: { team: { organizationId: ORG_ID } } });
    await prisma.project.deleteMany({ where: { team: { organizationId: ORG_ID } } });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { email: { contains: ns } } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  });

  describe("given any member minting their own personal key", () => {
    /** @scenario Any authenticated user can lazy-mint their own personal VK via CLI device-flow */
    it("mints a personal VK owned by the caller with no explicit grant", async () => {
      const issued = await callerFor(LEO).personalVirtualKeys.issuePersonal({
        organizationId: ORG_ID,
        label: "leo-laptop",
      });
      expect(issued.secret).toBeTruthy();
      const minted = await prisma.virtualKey.findUniqueOrThrow({
        where: { id: issued.id },
      });
      expect(minted.principalUserId).toBe(LEO);
    });
  });

  describe("given the caller lists their own personal keys", () => {
    /** @scenario A user can view their own personal VK without any explicit grant */
    it("returns the caller's own keys and not another user's", async () => {
      const ids = (
        await callerFor(LEO).personalVirtualKeys.list({ organizationId: ORG_ID })
      ).map((k) => k.id);
      expect(ids).toContain(leoVk);
      expect(ids).not.toContain(mayaVk);
    });
  });

  describe("given the caller targets another user's personal keys", () => {
    /** @scenario A user cannot view another user's personal VK without virtualKeys:viewOtherPersonal */
    it("rejects a virtualKeys:view-only holder naming the missing perm", async () => {
      await expect(
        callerFor(MAYA).personalVirtualKeys.list({
          organizationId: ORG_ID,
          targetUserId: LEO,
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("virtualKeys:viewOtherPersonal"),
      });
    });

    /** @scenario Org member roles do NOT gain virtualKeys:viewOtherPersonal */
    it("rejects a plain org member with no grants", async () => {
      await expect(
        callerFor(PLAIN).personalVirtualKeys.list({
          organizationId: ORG_ID,
          targetUserId: LEO,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("given an auditor with viewOtherPersonal", () => {
    /** @scenario Org admin with viewOtherPersonal can audit other users' personal VKs (offboarding sweep) */
    it("returns every member's personal keys when no target is given", async () => {
      const ids = (
        await callerFor(SWEEPER).personalVirtualKeys.list({ organizationId: ORG_ID })
      ).map((k) => k.id);
      expect(ids).toContain(leoVk);
      expect(ids).toContain(mayaVk);
    });

    /** @scenario Existing org admins automatically gain virtualKeys:viewOtherPersonal on migrate */
    it("lets an ADMIN-template holder read another user's keys without an explicit perm binding", async () => {
      const ids = (
        await callerFor(ORG_ADMIN).personalVirtualKeys.list({
          organizationId: ORG_ID,
          targetUserId: LEO,
        })
      ).map((k) => k.id);
      expect(ids).toContain(leoVk);
      expect(ids).not.toContain(mayaVk);
    });
  });
});
