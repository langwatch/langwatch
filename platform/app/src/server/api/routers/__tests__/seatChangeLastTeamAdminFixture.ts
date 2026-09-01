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
import { vi } from "vitest";
import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import { cleanupTestRows } from "../../../../test-utils/cleanupTestRows";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { OrganizationService } from "../../../app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "../../../app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "../../../app-layer/presets";
import { PlanProviderService } from "../../../app-layer/subscription/plan-provider";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { AppOrganizationRuntime } from "~/runtime/app/features/organization";

export type SeatChangeFixture = Awaited<ReturnType<typeof createSeatChangeFixture>>;

/** Everything the fixture wrote, and everything a suite reads it back by. */
type SeatChangeSeed = {
  organizationId: string;
  adminUserId: string;
  adminEmail: string;
  soloUserId: string;
  companionUserId: string;
  onlyAdminTeamId: string;
  onlyAdminTeamName: string;
  alsoOnlyAdminTeamId: string;
  sharedWithAnotherAdminTeamId: string;
  sharedProjectId: string;
  personalTeamId: string;
  personalProjectId: string;
};

type SeatChangeMembers = Awaited<ReturnType<typeof createMembers>>;

async function createMembers({ prisma, ns }: { prisma: PrismaClient; ns: string }) {
  const adminEmail = `${ns}-admin@example.com`;

  const [admin, solo, companion] = await Promise.all([
    prisma.user.create({ data: { name: "Org Admin", email: adminEmail } }),
    prisma.user.create({
      data: { name: "Solo Admin", email: `${ns}-solo@example.com` },
    }),
    prisma.user.create({
      data: { name: "Companion", email: `${ns}-companion@example.com` },
    }),
  ]);

  return {
    adminEmail,
    adminId: admin.id,
    soloId: solo.id,
    companionId: companion.id,
  };
}

async function createOrganization({
  prisma,
  ns,
  members,
}: {
  prisma: PrismaClient;
  ns: string;
  members: SeatChangeMembers;
}) {
  const { id: organizationId } = await prisma.organization.create({
    data: { name: `ACME ${ns}`, slug: `--test-org-${ns}` },
  });

  for (const [userId, role] of [
    [members.adminId, OrganizationUserRole.ADMIN],
    [members.soloId, OrganizationUserRole.MEMBER],
    [members.companionId, OrganizationUserRole.MEMBER],
  ] as const) {
    await prisma.organizationUser.create({
      data: { userId, organizationId, role },
    });
  }

  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId,
      userId: members.adminId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
    },
  });

  return organizationId;
}

async function createSharedTeams({
  prisma,
  ns,
  organizationId,
}: {
  prisma: PrismaClient;
  ns: string;
  organizationId: string;
}) {
  // Selects the name as well as the id: the guard suite asserts on the name the
  // refusal carries, and a second copy of this template would drift from it
  // silently and fail pointing at the wrong file.
  const createTeam = (label: string) =>
    prisma.team.create({
      data: {
        id: generate(KSUID_RESOURCES.TEAM).toString(),
        name: `${label} ${ns}`,
        slug: `${ns}-${label}`,
        organizationId,
      },
      select: { id: true, name: true },
    });

  const onlyAdminTeam = await createTeam("solo-one");
  const alsoOnlyAdminTeam = await createTeam("solo-two");
  const sharedWithAnotherAdminTeam = await createTeam("shared");

  return {
    onlyAdminTeamId: onlyAdminTeam.id,
    onlyAdminTeamName: onlyAdminTeam.name,
    alsoOnlyAdminTeamId: alsoOnlyAdminTeam.id,
    sharedWithAnotherAdminTeamId: sharedWithAnotherAdminTeam.id,
  };
}

/**
 * A shared project (for PROJECT-scoped access rows the seat correction must
 * reach) and the solo user's personal workspace (a personal team + personal
 * project the correction must never touch — the workspace design keeps its
 * stored owner ADMIN row and caps it at resolution, so re-promoting restores
 * writes with no repair; see
 * specs/ai-gateway/governance/personal-workspace-integrity.feature).
 */
async function createProjects({
  prisma,
  ns,
  organizationId,
  onlyAdminTeamId,
  soloUserId,
}: {
  prisma: PrismaClient;
  ns: string;
  organizationId: string;
  onlyAdminTeamId: string;
  soloUserId: string;
}) {
  const sharedProject = await prisma.project.create({
    data: {
      name: `Shared project ${ns}`,
      slug: `${ns}-shared-project`,
      apiKey: `test-key-${ns}-shared`,
      teamId: onlyAdminTeamId,
      language: "other",
      framework: "other",
    },
    select: { id: true },
  });

  const personalTeam = await prisma.team.create({
    data: {
      id: generate(KSUID_RESOURCES.TEAM).toString(),
      name: `Workspace ${ns}`,
      slug: `${ns}-personal`,
      organizationId,
      isPersonal: true,
      ownerUserId: soloUserId,
    },
    select: { id: true },
  });
  const personalProject = await prisma.project.create({
    data: {
      name: `Personal project ${ns}`,
      slug: `${ns}-personal-project`,
      apiKey: `test-key-${ns}-personal`,
      teamId: personalTeam.id,
      language: "other",
      framework: "other",
      isPersonal: true,
      ownerUserId: soloUserId,
    },
    select: { id: true },
  });

  return {
    sharedProjectId: sharedProject.id,
    personalTeamId: personalTeam.id,
    personalProjectId: personalProject.id,
  };
}

async function seedOrganization({
  prisma,
  ns,
}: {
  prisma: PrismaClient;
  ns: string;
}): Promise<SeatChangeSeed> {
  const members = await createMembers({ prisma, ns });
  const organizationId = await createOrganization({ prisma, ns, members });
  const teams = await createSharedTeams({ prisma, ns, organizationId });
  const projects = await createProjects({
    prisma,
    ns,
    organizationId,
    onlyAdminTeamId: teams.onlyAdminTeamId,
    soloUserId: members.soloId,
  });

  return {
    organizationId,
    adminUserId: members.adminId,
    adminEmail: members.adminEmail,
    soloUserId: members.soloId,
    companionUserId: members.companionId,
    ...teams,
    ...projects,
  };
}

/**
 * Installed per test rather than once per file: the app is a process singleton,
 * so a neighbouring suite's teardown resetting it between two of these tests
 * would otherwise leave the null repository in place, and every assertion here
 * would hold on a mutation that wrote nothing.
 */
async function installTestApp({ prisma }: { prisma: PrismaClient }) {
  await resetApp();
  const base = createTestApp({
    planProvider: PlanProviderService.create({
      getActivePlan: vi.fn().mockResolvedValue({
        ...FREE_PLAN,
        overrideAddingLimitations: false,
        maxMembers: 100,
        maxMembersLite: 100,
      }),
    }),
  });
  const canonicalOrganizations = AppOrganizationRuntime.create({
    database: prisma,
    authz: base.permissions,
    grants: base.authzGrants,
  }).build();
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
      createTestApp().prompts.promptService,
      canonicalOrganizations,
    ),
    usageLimits: {
      notifyResourceLimitReached: vi.fn().mockResolvedValue(undefined),
      checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
    } as any,
  });
}

function bindTeamRole({
  prisma,
  organizationId,
  userId,
  teamId,
  role,
}: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  teamId: string;
  role: TeamUserRole;
}) {
  return prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId,
      userId,
      role,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    },
  });
}

/**
 * Put the member back the way this fixture built them.
 *
 * The first seat change rewrites their bindings, so an assertion that a
 * correction happened would otherwise hold on whatever the previous test left
 * behind. The delete goes through the guarded helper for the same reason a
 * teardown does: these ids come from an async setup, and an unanchored
 * `deleteMany` matches every row rather than none.
 */
async function resetMemberships({
  prisma,
  seed,
}: {
  prisma: PrismaClient;
  seed: SeatChangeSeed;
}) {
  await installTestApp({ prisma });

  const { organizationId, soloUserId, companionUserId } = seed;
  await cleanupTestRows(prisma, [
    [
      "roleBinding",
      {
        organizationId,
        userId: { in: [soloUserId, companionUserId] },
        scopeType: {
          in: [RoleBindingScopeType.TEAM, RoleBindingScopeType.PROJECT],
        },
      },
    ],
  ]);
  await prisma.organizationUser.update({
    where: { userId_organizationId: { userId: soloUserId, organizationId } },
    data: { role: OrganizationUserRole.MEMBER },
  });

  for (const teamId of [
    seed.onlyAdminTeamId,
    seed.alsoOnlyAdminTeamId,
    seed.sharedWithAnotherAdminTeamId,
    seed.personalTeamId,
  ]) {
    await bindTeamRole({
      prisma,
      organizationId,
      userId: soloUserId,
      teamId,
      role: TeamUserRole.ADMIN,
    });
  }
  await bindTeamRole({
    prisma,
    organizationId,
    userId: companionUserId,
    teamId: seed.sharedWithAnotherAdminTeamId,
    role: TeamUserRole.ADMIN,
  });
  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId,
      userId: soloUserId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.PROJECT,
      scopeId: seed.sharedProjectId,
    },
  });
}

async function removeSeed({
  prisma,
  seed,
}: {
  prisma: PrismaClient;
  seed: SeatChangeSeed;
}) {
  await resetApp();
  await cleanupTestRows(prisma, [
    ["roleBinding", { organizationId: seed.organizationId }],
    ["organizationUser", { organizationId: seed.organizationId }],
    ["project", { id: { in: [seed.sharedProjectId, seed.personalProjectId] } }],
    ["team", { organizationId: seed.organizationId }],
    ["organization", { id: seed.organizationId }],
    [
      "user",
      {
        id: {
          in: [seed.adminUserId, seed.soloUserId, seed.companionUserId],
        },
      },
    ],
  ]);
}

/**
 * A group holding the Admin role on a team, the way SCIM provisioning grants
 * it. The last-admin guards count the group's members as the team's admins, so
 * suites use this to assert a demotion the group can absorb goes through, and
 * that an empty group (no `memberUserId`) keeps nothing administered. Rows are
 * removed on the way out so `resetMemberships` stays truthful between tests.
 */
async function withAdminGroupOn({
  prisma,
  organizationId,
  ns,
  teamId,
  memberUserId,
  run,
}: {
  prisma: PrismaClient;
  organizationId: string;
  ns: string;
  teamId: string;
  memberUserId?: string;
  run: () => Promise<void>;
}) {
  const group = await prisma.group.create({
    data: {
      organizationId,
      name: "Provisioned admins",
      slug: `provisioned-admins-${ns}`,
    },
  });
  if (memberUserId) {
    await prisma.groupMembership.create({
      data: { userId: memberUserId, groupId: group.id },
    });
  }
  const binding = await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId,
      groupId: group.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    },
  });
  try {
    await run();
  } finally {
    await prisma.roleBinding.deleteMany({ where: { id: binding.id } });
    await prisma.groupMembership.deleteMany({ where: { groupId: group.id } });
    await prisma.group.deleteMany({ where: { id: group.id } });
  }
}

function callerAsAdmin(seed: SeatChangeSeed) {
  return appRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: {
          id: seed.adminUserId,
          name: "Org Admin",
          email: seed.adminEmail,
        },
        expires: "1",
      } as any,
    }),
  );
}

async function teamRoleOf({
  prisma,
  organizationId,
  userId,
  teamId,
}: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
  teamId: string;
}) {
  const binding = await prisma.roleBinding.findFirst({
    where: {
      organizationId,
      userId,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    },
    select: { role: true },
  });

  return binding?.role ?? null;
}

async function organizationRoleOf({
  prisma,
  organizationId,
  userId,
}: {
  prisma: PrismaClient;
  organizationId: string;
  userId: string;
}) {
  const membership = await prisma.organizationUser.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true },
  });

  return membership?.role ?? null;
}

export async function createSeatChangeFixture({
  prisma,
  ns,
}: {
  prisma: PrismaClient;
  ns: string;
}) {
  const seed = await seedOrganization({ prisma, ns });
  await installTestApp({ prisma });
  const { organizationId } = seed;

  return {
    ...seed,

    callerAsAdmin: () => callerAsAdmin(seed),

    teamRoleOf: (where: { userId: string; teamId: string }) =>
      teamRoleOf({ prisma, organizationId, ...where }),

    projectBindingOf: (where: { userId: string; projectId: string }) =>
      prisma.roleBinding.findFirst({
        where: {
          organizationId,
          userId: where.userId,
          scopeType: RoleBindingScopeType.PROJECT,
          scopeId: where.projectId,
        },
        select: { role: true, customRoleId: true },
      }),

    organizationRoleOfSoloUser: () =>
      organizationRoleOf({ prisma, organizationId, userId: seed.soloUserId }),

    withAdminGroupOn: ({
      teamId,
      memberUserId,
      run,
    }: {
      teamId: string;
      memberUserId?: string;
      run: () => Promise<void>;
    }) =>
      withAdminGroupOn({
        prisma,
        organizationId,
        ns,
        teamId,
        memberUserId,
        run,
      }),

    resetMemberships: () => resetMemberships({ prisma, seed }),

    cleanup: () => removeSeed({ prisma, seed }),
  };
}
