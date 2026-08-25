import type {
  BackofficeOrganizationRef,
  BackofficeProjectRef,
  BackofficeUserRow,
  UserWithBackofficeIncludes,
} from "@langwatch/ops-contract";

const USER_BACKOFFICE_INCLUDE = {
  orgMemberships: {
    include: {
      organization: {
        include: {
          teams: {
            where: { archivedAt: null },
            include: { projects: { where: { archivedAt: null } } },
          },
        },
      },
    },
  },
} as const;

export class PrismaAdminUserMapper {
  static readonly USER_BACKOFFICE_INCLUDE = USER_BACKOFFICE_INCLUDE;

  private constructor() {}

  static create(): PrismaAdminUserMapper {
    return new PrismaAdminUserMapper();
  }

  static map(user: UserWithBackofficeIncludes): BackofficeUserRow {
    const organizations = new Map<string, BackofficeOrganizationRef>();
    const projects = new Map<string, BackofficeProjectRef>();
    for (const membership of user.orgMemberships ?? []) {
      const organization = membership.organization;
      organizations.set(organization.id, {
        id: organization.id,
        name: organization.name,
      });
      for (const team of organization.teams ?? []) {
        for (const project of team.projects ?? []) {
          projects.set(project.id, {
            id: project.id,
            name: project.name,
            slug: project.slug,
          });
        }
      }
    }
    return {
      ...user,
      organizations: [...organizations.values()],
      projects: [...projects.values()],
    };
  }
}
