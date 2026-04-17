import type { Organization, Project, Team, User } from "@prisma/client";

/**
 * Prisma `include` shape used by the Backoffice Users list to resolve every
 * project each user can see in the main app's project switcher.
 *
 * The visibility rule mirrors the main app (see
 * `organization.prisma.repository.ts#getAllForUser`): a user's project
 * visibility comes from their org memberships → org.teams → team.projects.
 * A TeamUser row is NOT required. Historically the Backoffice walked
 * teamMemberships instead, which meant users who had an OrganizationUser
 * but no TeamUser rendered with an empty Projects column even though the
 * main app happily showed those projects in their switcher.
 *
 * Non-archived teams and projects only — archived rows must not leak onto
 * the admin table either.
 */
export const USER_BACKOFFICE_INCLUDE = {
  orgMemberships: {
    include: {
      organization: {
        include: {
          teams: {
            where: { archivedAt: null },
            include: {
              projects: { where: { archivedAt: null } },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Narrowed user shape after `USER_BACKOFFICE_INCLUDE` has been applied.
 * Keeps the rest of the User fields intact so downstream code (like the
 * ra-data-simple-prisma handler) can spread them through unchanged.
 */
export type UserWithBackofficeIncludes = User & {
  orgMemberships: {
    organization: Organization & {
      teams: (Team & { projects: Project[] })[];
    };
  }[];
};

export interface BackofficeOrganizationRef {
  id: string;
  name: string;
}

export interface BackofficeProjectRef {
  id: string;
  name: string;
  slug: string;
}

export interface BackofficeUserRow extends User {
  organizations: BackofficeOrganizationRef[];
  projects: BackofficeProjectRef[];
}

/**
 * Flatten a Prisma-loaded user into the row shape the Backoffice Users table
 * renders. Dedupes across memberships so each org / project chip appears
 * once, and traverses org → teams → projects so project visibility matches
 * the main app's rule (org membership is enough; TeamUser is NOT required).
 *
 * Isolated from the Hono handler so the visibility rule can be pinned with
 * a plain unit test — the regression we care about here is "a user with an
 * OrganizationUser but no TeamUser still gets their projects", and having
 * the traversal in a pure function means a test no longer needs the whole
 * admin route + DB stack to prove that.
 */
export function mapUserToBackofficeRow(
  user: UserWithBackofficeIncludes,
): BackofficeUserRow {
  const orgMap = new Map<string, BackofficeOrganizationRef>();
  const projectMap = new Map<string, BackofficeProjectRef>();

  for (const membership of user.orgMemberships ?? []) {
    const org = membership.organization;
    if (!orgMap.has(org.id)) {
      orgMap.set(org.id, { id: org.id, name: org.name });
    }
    for (const team of org.teams ?? []) {
      for (const project of team.projects ?? []) {
        if (!projectMap.has(project.id)) {
          projectMap.set(project.id, {
            id: project.id,
            name: project.name,
            slug: project.slug,
          });
        }
      }
    }
  }

  return {
    ...user,
    organizations: Array.from(orgMap.values()),
    projects: Array.from(projectMap.values()),
  };
}
