/**
 * The organization both seat-change-last-team-admin suites drive.
 *
 * One member who is the only admin of two shared teams, one team where they
 * share the role with somebody else, and an organization admin holding an
 * ORGANIZATION-scoped ADMIN binding. That last binding is the reason a seat
 * correction is allowed to take away a team's only team-scoped admin, so it is
 * fixture state rather than incidental.
 *
 * Shared because the two suites ask opposite questions of the same shape: what a
 * seat correction is allowed to do, and what a team-local decision still is not.
 * Each suite passes its own namespace, so their rows never meet.
 */

import { generate } from "@langwatch/ksuid";
import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { vi } from "vitest";
import { KSUID_RESOURCES } from "~/utils/constants";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { cleanupTestRows } from "../../../../test-utils/cleanupTestRows";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { OrganizationService } from "../../../app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "../../../app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "../../../app-layer/presets";
import { PlanProviderService } from "../../../app-layer/subscription/plan-provider";
import { PromptTagRepository } from "../../../prompt-config/repositories/prompt-tag.repository";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

export type SeatChangeFixture = Awaited<
  ReturnType<typeof createSeatChangeFixture>
>;

export async function createSeatChangeFixture({
  prisma,
  ns,
}: {
  prisma: PrismaClient;
  ns: string;
}) {
  const adminEmail = `${ns}-admin@example.com`;
  const soloEmail = `${ns}-solo@example.com`;
  const companionEmail = `${ns}-companion@example.com`;

  const [admin, solo, companion] = await Promise.all([
    prisma.user.create({ data: { name: "Org Admin", email: adminEmail } }),
    prisma.user.create({ data: { name: "Solo Admin", email: soloEmail } }),
    prisma.user.create({ data: { name: "Companion", email: companionEmail } }),
  ]);

  const organization = await prisma.organization.create({
    data: { name: `ACME ${ns}`, slug: `--test-org-${ns}` },
  });
  const organizationId = organization.id;

  for (const [userId, role] of [
    [admin.id, OrganizationUserRole.ADMIN],
    [solo.id, OrganizationUserRole.MEMBER],
    [companion.id, OrganizationUserRole.MEMBER],
  ] as const) {
    await prisma.organizationUser.create({
      data: { userId, organizationId, role },
    });
  }

  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId,
      userId: admin.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
    },
  });

  const createTeam = async (label: string) => {
    const team = await prisma.team.create({
      data: {
        id: generate(KSUID_RESOURCES.TEAM).toString(),
        name: `${label} ${ns}`,
        slug: `${ns}-${label}`,
        organizationId,
      },
    });
    return team.id;
  };

  const onlyAdminTeamId = await createTeam("solo-one");
  const alsoOnlyAdminTeamId = await createTeam("solo-two");
  const sharedWithAnotherAdminTeamId = await createTeam("shared");

  await resetApp();
  globalForApp.__langwatch_app = createTestApp({
    // FREE_PLAN gives away no Lite Member seats, so without this a seat change
    // is refused for the allowance rather than for anything these suites are
    // about.
    planProvider: PlanProviderService.create({
      getActivePlan: vi.fn().mockResolvedValue({
        ...FREE_PLAN,
        overrideAddingLimitations: false,
        maxMembers: 100,
        maxMembersLite: 100,
      }),
    }),
    organizations: new OrganizationService(
      new PrismaOrganizationRepository(prisma),
      new PromptTagRepository(prisma),
    ),
    usageLimits: {
      notifyResourceLimitReached: vi.fn().mockResolvedValue(undefined),
      checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
    } as any,
  });

  const bindTeamRole = ({
    userId,
    teamId,
    role,
  }: {
    userId: string;
    teamId: string;
    role: TeamUserRole;
  }) =>
    prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        userId,
        role,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      },
    });

  return {
    organizationId,
    adminUserId: admin.id,
    soloUserId: solo.id,
    companionUserId: companion.id,
    adminEmail,
    onlyAdminTeamId,
    alsoOnlyAdminTeamId,
    sharedWithAnotherAdminTeamId,
    onlyAdminTeamName: `solo-one ${ns}`,

    callerAsAdmin: () =>
      appRouter.createCaller(
        createInnerTRPCContext({
          session: {
            user: { id: admin.id, name: "Org Admin", email: adminEmail },
            expires: "1",
          } as any,
        }),
      ),

    bindTeamRole,

    teamRoleOf: async ({
      userId,
      teamId,
    }: {
      userId: string;
      teamId: string;
    }) =>
      (
        await prisma.roleBinding.findFirst({
          where: {
            organizationId,
            userId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
          },
          select: { role: true },
        })
      )?.role ?? null,

    organizationRoleOfSoloUser: async () =>
      (
        await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: { userId: solo.id, organizationId },
          },
          select: { role: true },
        })
      )?.role ?? null,

    /**
     * Put the member back the way this fixture built them.
     *
     * The first seat change rewrites their bindings, so an assertion that a
     * correction happened would otherwise hold on whatever the previous test
     * left behind. The delete goes through the guarded helper for the same
     * reason a teardown does: these ids come from an async setup, and an
     * unanchored `deleteMany` matches every row rather than none.
     */
    resetMemberships: async () => {
      await cleanupTestRows(prisma, [
        [
          "roleBinding",
          {
            organizationId,
            userId: { in: [solo.id, companion.id] },
            scopeType: RoleBindingScopeType.TEAM,
          },
        ],
      ]);
      await prisma.organizationUser.update({
        where: {
          userId_organizationId: { userId: solo.id, organizationId },
        },
        data: { role: OrganizationUserRole.MEMBER },
      });
      for (const teamId of [
        onlyAdminTeamId,
        alsoOnlyAdminTeamId,
        sharedWithAnotherAdminTeamId,
      ]) {
        await bindTeamRole({
          userId: solo.id,
          teamId,
          role: TeamUserRole.ADMIN,
        });
      }
      await bindTeamRole({
        userId: companion.id,
        teamId: sharedWithAnotherAdminTeamId,
        role: TeamUserRole.ADMIN,
      });
    },

    cleanup: async () => {
      await resetApp();
      await cleanupTestRows(prisma, [
        ["roleBinding", { organizationId }],
        ["organizationUser", { organizationId }],
        ["team", { organizationId }],
        ["organization", { id: organizationId }],
        ["user", { id: { in: [admin.id, solo.id, companion.id] } }],
      ]);
    },
  };
}
