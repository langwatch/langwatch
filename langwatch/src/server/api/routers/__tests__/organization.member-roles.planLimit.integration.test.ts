/**
 * @vitest-environment node
 *
 * Integration tests for organization member role plan limit enforcement.
 * Tests updateMemberRole and updateTeamMemberRole with real database —
 * only mocks planProvider (system boundary).
 *
 * Requires: PostgreSQL database (Prisma)
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
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
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "../../../db";
import { LICENSE_LIMIT_ERRORS } from "../../../license-enforcement/license-limit-guard";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

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

    // The ORGANIZATION-scoped binding is what actually confers
    // `organization:manage`. `OrganizationUser.role = ADMIN` alone does not:
    // `hasOrganizationPermission` grants every member only MEMBER's base bag
    // as a floor and resolves everything above it through bindings, and the
    // legacy TeamUser union deliberately cannot confer `organization:*`
    // (ADR-021). Without this the caller is refused before any plan-limit
    // logic runs, so the suite would assert nothing about plan limits.
    await prisma.roleBinding.create({
      data: {
        organizationId: organization.id,
        userId: adminUser.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organization.id,
      },
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
    // Clean up in reverse creation order
    await prisma.teamUser
      .deleteMany({
        where: {
          team: { slug: `--test-team-${testNamespace}` },
        },
      })
      .catch(() => {});
    await prisma.customRole
      .deleteMany({
        where: { organizationId },
      })
      .catch(() => {});
    await prisma.team
      .deleteMany({
        where: { slug: `--test-team-${testNamespace}` },
      })
      .catch(() => {});
    await prisma.organizationUser
      .deleteMany({
        where: { organizationId },
      })
      .catch(() => {});
    await prisma.organization
      .delete({ where: { id: organizationId } })
      .catch(() => {});
    await prisma.user
      .deleteMany({
        where: {
          email: { endsWith: `${testNamespace}@example.com` },
        },
      })
      .catch(() => {});

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

  describe("updateMemberRole", () => {
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
          message: LICENSE_LIMIT_ERRORS.MEMBER_LITE_LIMIT,
        });
      });

      it("allows when overrideAddingLimitations is true", async () => {
        mockGetActivePlan.mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 0, // No lite members allowed, but override active
          overrideAddingLimitations: true,
        });

        const caller = createCaller();

        // Resolving IS the assertion: the sibling test above proves the same
        // call is rejected with MEMBER_LITE_LIMIT when the override is off,
        // so the pair isolates the override as the only difference.
        //
        // Deliberately not asserting the persisted row. `createTestApp` wires
        // `organizations` to a NullOrganizationRepository, so the write this
        // procedure delegates is a no-op here by design — the row would still
        // read MEMBER however well the limit gate behaved. Persistence is the
        // repository's own contract and is tested there.
        await expect(
          caller.organization.updateMemberRole({
            userId: targetUserId,
            organizationId,
            role: OrganizationUserRole.EXTERNAL,
          }),
        ).resolves.toEqual({ success: true });
      });
    });
  });

  describe("updateTeamMemberRole", () => {
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

        // The guard reads the custom role through `getUserCustomRoleBinding`
        // — a RoleBinding lookup — not through the legacy
        // `TeamUser.assignedRoleId` set above. Without this binding the
        // caller's old permissions read as undefined, `getRoleChangeType`
        // sees no full-to-lite transition, and the limit is never asserted:
        // the mutation returns `{ success: true }` and the rejection this
        // block is about silently stops being tested.
        await prisma.roleBinding.deleteMany({
          where: {
            organizationId,
            userId: targetUserId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
          },
        });
        await prisma.roleBinding.create({
          data: {
            organizationId,
            userId: targetUserId,
            role: TeamUserRole.CUSTOM,
            customRoleId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
          },
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
          message: LICENSE_LIMIT_ERRORS.MEMBER_LITE_LIMIT,
        });
      });

      it("allows when overrideAddingLimitations is true", async () => {
        mockGetActivePlan.mockResolvedValue({
          maxMembers: 100,
          maxMembersLite: 0, // No lite members allowed, but override active
          overrideAddingLimitations: true,
        });

        const caller = createCaller();

        // As above: resolving is the assertion, paired against the sibling
        // rejection. The persisted row is not checked because this app's
        // organization repository is a deliberate no-op.
        await expect(
          caller.organization.updateTeamMemberRole({
            teamId,
            userId: targetUserId,
            role: TeamUserRole.VIEWER,
          }),
        ).resolves.toEqual({ success: true });
      });
    });
  });
});
