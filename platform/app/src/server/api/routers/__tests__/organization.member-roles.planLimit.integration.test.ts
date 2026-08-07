/**
 * @vitest-environment node
 *
 * Integration tests for organization member role plan limit enforcement.
 * Tests updateMemberRole and updateTeamMemberRole with real database —
 * only mocks planProvider (system boundary).
 *
 * Requires: PostgreSQL database (Prisma)
 */

import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import {
  bindCustomRoleToTeam,
  grantOrganizationAdmin,
} from "./helpers/roleBindings";

describe("organization member role plan limit enforcement", () => {
  const testNamespace = `member-role-limit-${nanoid(8)}`;
  let organizationId: string;
  let adminUserId: string;
  let targetUserId: string;
  let teamId: string;
  let customRoleId: string;
  let mockGetActivePlan: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    // Create organization
    const organization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `--test-org-${testNamespace}`,
      },
    });
    organizationId = organization.id;

    // Create admin user (the caller)
    const adminUser = await prisma.user.create({
      data: {
        name: "Admin User",
        email: `admin-${testNamespace}@example.com`,
      },
    });
    adminUserId = adminUser.id;

    await prisma.organizationUser.create({
      data: {
        userId: adminUser.id,
        organizationId: organization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });

    // Create a team + admin membership so RBAC passes
    const team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `--test-team-${testNamespace}`,
        organizationId: organization.id,
      },
    });
    teamId = team.id;

    await prisma.teamUser.create({
      data: {
        userId: adminUser.id,
        teamId: team.id,
        role: TeamUserRole.ADMIN,
      },
    });

    // Without these the caller is refused before any plan-limit logic runs, so
    // the suite would assert nothing about plan limits — see the helper.
    //
    // The TEAM-scoped binding matters for a second reason: the repository's
    // "don't strand a team without an admin" guard counts TEAM-scoped ADMIN
    // *bindings*, not the `TeamUser` row above. With none, demoting anyone on
    // the team is refused with "No admin found for this team" before the plan
    // logic is reached.
    await grantOrganizationAdmin({
      prisma,
      organizationId: organization.id,
      userId: adminUser.id,
      teamId: team.id,
    });

    // Create a custom role with non-view permissions (makes EXTERNAL user a FullMember)
    const customRole = await prisma.customRole.create({
      data: {
        organizationId: organization.id,
        name: `test-editor-${testNamespace}`,
        permissions: ["project:create", "project:update"],
      },
    });
    customRoleId = customRole.id;

    // Create target user as MEMBER (full member)
    const targetUser = await prisma.user.create({
      data: {
        name: "Target User",
        email: `target-${testNamespace}@example.com`,
      },
    });
    targetUserId = targetUser.id;

    await prisma.organizationUser.create({
      data: {
        userId: targetUser.id,
        organizationId: organization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });

    await prisma.teamUser.create({
      data: {
        userId: targetUser.id,
        teamId: team.id,
        role: TeamUserRole.MEMBER,
      },
    });
  });

  beforeEach(async () => {
    await resetApp();
    mockGetActivePlan = vi.fn();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
      // A REAL organization service, against the test database. `createTestApp`
      // defaults to a NullOrganizationRepository, which resolves without
      // writing — so an allow-path test could only assert "the call didn't
      // throw", and a mutation that silently no-ops the override would pass.
      // The plan gate is what these tests are about, but proving the write
      // landed is what distinguishes "allowed" from "quietly dropped".
      organizations: new OrganizationService(
        new PrismaOrganizationRepository(prisma),
        new PromptTagRepository(prisma),
      ),
    });

    // Guarantee target user starts as MEMBER with built-in MEMBER team role
    await prisma.organizationUser.update({
      where: {
        userId_organizationId: {
          userId: targetUserId,
          organizationId,
        },
      },
      data: { role: OrganizationUserRole.MEMBER },
    });
    await prisma.teamUser.update({
      where: {
        userId_teamId: {
          userId: targetUserId,
          teamId,
        },
      },
      data: { role: TeamUserRole.MEMBER, assignedRoleId: null },
    });
  });

  afterEach(async () => {
    await resetApp();
  });

  afterAll(async () => {
    // Reverse creation order. RoleBindings hold an FK to CustomRole, so
    // they go first; the organization cascade would take them anyway, but
    // deleting them explicitly means a broken teardown says so.
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["teamUser", { teamId }],
      ["customRole", { organizationId }],
      ["team", { id: teamId }],
      ["organizationUser", { organizationId }],
      ["organization", { id: organizationId }],
      ["user", { email: { endsWith: `${testNamespace}@example.com` } }],
    ]);

    await resetApp();
  });

  function createCaller() {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: adminUserId },
        expires: "2099-01-01",
      },
      permissionChecked: true,
      publiclyShared: false,
    });
    return appRouter.createCaller(ctx);
  }

  describe("when calling updateMemberRole", () => {
    describe("when demoting MEMBER to EXTERNAL (full-to-lite change)", () => {
      it("rejects when lite member limit reached", async () => {
        mockGetActivePlan.mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 0, // No lite members allowed
          overrideAddingLimitations: false,
        });

        const caller = createCaller();

        await expect(
          caller.organization.updateMemberRole({
            userId: targetUserId,
            organizationId,
            role: OrganizationUserRole.EXTERNAL,
          }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          cause: {
            code: "resource_limit_exceeded",
            meta: { limitType: "membersLite" },
          },
        });
      });

      it("allows when overrideAddingLimitations is true", async () => {
        mockGetActivePlan.mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 0, // No lite members allowed, but override active
          overrideAddingLimitations: true,
        });

        const caller = createCaller();

        // Two assertions, and the second is the one that matters. The sibling
        // above proves this call is rejected when the override is off, so
        // resolving isolates the override — but resolving alone cannot tell
        // "the override let the write through" apart from "the write silently
        // did nothing". Reading the row back distinguishes them.
        await expect(
          caller.organization.updateMemberRole({
            userId: targetUserId,
            organizationId,
            role: OrganizationUserRole.EXTERNAL,
          }),
        ).resolves.toMatchObject({ success: true });

        const updated = await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: { userId: targetUserId, organizationId },
          },
        });
        expect(updated?.role).toBe(OrganizationUserRole.EXTERNAL);
      });
    });
  });

  describe("when calling updateTeamMemberRole", () => {
    describe("when changing EXTERNAL user from custom role to built-in VIEWER (full-to-lite change)", () => {
      beforeEach(async () => {
        // Set target user as EXTERNAL with custom role (non-view permissions → FullMember)
        await prisma.organizationUser.update({
          where: {
            userId_organizationId: {
              userId: targetUserId,
              organizationId,
            },
          },
          data: { role: OrganizationUserRole.EXTERNAL },
        });
        await prisma.teamUser.update({
          where: {
            userId_teamId: {
              userId: targetUserId,
              teamId,
            },
          },
          data: { role: TeamUserRole.CUSTOM, assignedRoleId: customRoleId },
        });

        // The binding, not the legacy `assignedRoleId` set above, is what the
        // guard reads — see the helper.
        await bindCustomRoleToTeam({
          prisma,
          organizationId,
          userId: targetUserId,
          teamId,
          customRoleId,
        });
      });

      it("rejects when lite member limit reached", async () => {
        mockGetActivePlan.mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 0, // No lite members allowed
          overrideAddingLimitations: false,
        });

        const caller = createCaller();

        await expect(
          caller.organization.updateTeamMemberRole({
            teamId,
            userId: targetUserId,
            role: TeamUserRole.VIEWER,
          }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          cause: {
            code: "resource_limit_exceeded",
            meta: { limitType: "membersLite" },
          },
        });
      });

      it("allows when overrideAddingLimitations is true", async () => {
        mockGetActivePlan.mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 0, // No lite members allowed, but override active
          overrideAddingLimitations: true,
        });

        const caller = createCaller();

        // As above: resolving isolates the override, the read-back proves the
        // write actually landed rather than being quietly dropped.
        await expect(
          caller.organization.updateTeamMemberRole({
            teamId,
            userId: targetUserId,
            role: TeamUserRole.VIEWER,
          }),
        ).resolves.toMatchObject({ success: true });

        // Read the BINDING, not the `TeamUser` row. `updateTeamMemberRole`
        // replaces the TEAM-scoped RoleBinding and leaves the legacy row
        // untouched — asserting on `TeamUser.role` here would fail against
        // correct behaviour, which is what the original assertion did.
        const binding = await prisma.roleBinding.findFirst({
          where: {
            organizationId,
            userId: targetUserId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
          },
        });
        expect(binding?.role).toBe(TeamUserRole.VIEWER);
        // The custom role is cleared, not carried over — the point of the
        // full-to-lite change under test.
        expect(binding?.customRoleId).toBeNull();
      });
    });
  });
});
