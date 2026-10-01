import type {
  BackofficeOrganizationRef,
  BackofficeProjectRef,
  BackofficeUserRow,
  UserWithBackofficeIncludes,
} from "@langwatch/ops-contract";

/** One user row with the organizations and live projects its memberships reach. */
export function toBackofficeUserRow(user: UserWithBackofficeIncludes): BackofficeUserRow {
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
