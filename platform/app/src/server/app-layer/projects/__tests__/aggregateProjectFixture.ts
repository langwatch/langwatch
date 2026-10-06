/**
 * One organisation shaped the way ADR-144's background describes it: several
 * personal projects, an organisation admin, and a member who is not an admin,
 * with real grants so the permission engine decides as it does in production.
 */
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import {
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";
import type { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";

/**
 * The test app's organisation service is a null one; these suites read
 * organisation roles and the project switcher for real.
 */
export function realOrganizationService(prisma: PrismaClient) {
  return new OrganizationService(new PrismaOrganizationRepository(prisma), {
    seedForOrg: async () => {
      /* not exercised */
    },
  } as unknown as PromptTagRepository);
}

export type AggregateFixture = Awaited<
  ReturnType<typeof seedAggregateOrganization>
>;

export async function seedAggregateOrganization(
  prisma: PrismaClient,
  { label }: { label: string },
) {
  const ns = `${label}-${nanoid(8)}`;
  const organization = await prisma.organization.create({
    data: { name: `Aggregate Org ${ns}`, slug: `--test-org-${ns}` },
  });
  const organizationId = organization.id;
  const team = await prisma.team.create({
    data: {
      name: `Shared Team ${ns}`,
      slug: `--test-team-${ns}`,
      organizationId,
    },
  });
  const departments = {
    engineering: await prisma.department.create({
      data: { organizationId, name: "Engineering" },
    }),
    sales: await prisma.department.create({
      data: { organizationId, name: "Sales" },
    }),
  };

  const makeUser = async ({
    handle,
    organizationRole,
    teamRole,
    departmentId,
  }: {
    handle: string;
    organizationRole: OrganizationUserRole;
    teamRole?: TeamUserRole;
    departmentId?: string;
  }) => {
    const user = await prisma.user.create({
      data: { name: `${handle} ${ns}`, email: `${handle}-${ns}@example.com` },
    });
    await prisma.organizationUser.create({
      data: {
        userId: user.id,
        organizationId,
        role: organizationRole,
        departmentId,
      },
    });
    // A Developer seat holds no organisation-wide binding: its reach is its
    // own personal team plus whatever team it is put on.
    if (organizationRole !== OrganizationUserRole.DEVELOPER) {
      await seedRoleBinding(prisma, {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        userId: user.id,
        role:
          organizationRole === OrganizationUserRole.ADMIN
            ? TeamUserRole.ADMIN
            : TeamUserRole.VIEWER,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      });
    }
    if (teamRole) {
      await prisma.teamUser.create({
        data: { userId: user.id, teamId: team.id, role: teamRole },
      });
      await seedRoleBinding(prisma, {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        userId: user.id,
        role: teamRole,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: team.id,
      });
    }
    return user;
  };

  /** A personal workspace: its own team holding its one personal project. */
  const makePersonalProject = async ({
    ownerUserId,
    handle,
  }: {
    ownerUserId: string;
    handle: string;
  }) => {
    const personalTeam = await prisma.team.create({
      data: {
        name: `${handle} workspace ${ns}`,
        slug: `--test-personal-${handle}-${ns}`,
        organizationId,
        isPersonal: true,
        ownerUserId,
      },
    });
    return prisma.project.create({
      data: {
        name: `${handle} personal ${ns}`,
        slug: `--test-personal-project-${handle}-${ns}`,
        apiKey: `test-key-${handle}-${ns}`,
        teamId: personalTeam.id,
        language: "python",
        framework: "openai",
        isPersonal: true,
        ownerUserId,
      },
    });
  };

  const makeTeamProject = (handle: string) =>
    prisma.project.create({
      data: {
        name: `${handle} ${ns}`,
        slug: `--test-project-${handle}-${ns}`,
        apiKey: `test-key-${handle}-${ns}`,
        teamId: team.id,
        language: "python",
        framework: "openai",
      },
    });

  const admin = await makeUser({
    handle: "admin",
    organizationRole: OrganizationUserRole.ADMIN,
    teamRole: TeamUserRole.ADMIN,
  });
  const member = await makeUser({
    handle: "member",
    organizationRole: OrganizationUserRole.MEMBER,
    teamRole: TeamUserRole.ADMIN,
  });
  const developer = await makeUser({
    handle: "developer",
    organizationRole: OrganizationUserRole.DEVELOPER,
    teamRole: TeamUserRole.ADMIN,
  });
  const engineer = await makeUser({
    handle: "engineer",
    organizationRole: OrganizationUserRole.MEMBER,
    departmentId: departments.engineering.id,
  });
  const seller = await makeUser({
    handle: "seller",
    organizationRole: OrganizationUserRole.MEMBER,
    departmentId: departments.sales.id,
  });

  const personal = {
    engineer: await makePersonalProject({
      ownerUserId: engineer.id,
      handle: "engineer",
    }),
    seller: await makePersonalProject({
      ownerUserId: seller.id,
      handle: "seller",
    }),
  };
  const shared = await makeTeamProject("shared");
  /** An aggregate on the shared team, as the create mutation stores one. */
  const makeAggregate = (handle: string) =>
    prisma.project.create({
      data: {
        name: `${handle} ${ns}`,
        slug: `--test-aggregate-${handle}-${ns}`,
        apiKey: `test-key-aggregate-${handle}-${ns}`,
        teamId: team.id,
        language: "other",
        framework: "other",
        kind: "aggregate",
        aggregateRule: { kind: "all-personal" },
      },
    });
  const governance = await prisma.project.create({
    data: {
      name: `Governance ${ns}`,
      slug: `--test-governance-${ns}`,
      apiKey: `test-key-governance-${ns}`,
      teamId: team.id,
      language: "other",
      framework: "other",
      kind: "internal_governance",
    },
  });

  return {
    ns,
    organizationId,
    team,
    departments,
    admin,
    member,
    developer,
    engineer,
    seller,
    personal,
    shared,
    governance,
    makeUser,
    makeTeamProject,
    makeAggregate,
    cleanup: () =>
      cleanupTestRows(prisma, [
        ["grant", { organizationId }],
        ["roleBinding", { organizationId }],
        ["teamUser", { team: { organizationId } }],
        ["project", { team: { organizationId } }],
        ["team", { organizationId }],
        ["department", { organizationId }],
        ["organizationUser", { organizationId }],
        ["organization", { id: organizationId }],
        ["user", { email: { contains: ns } }],
      ]),
  };
}
