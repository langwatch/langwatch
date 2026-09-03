import { OrganizationUserRole, TeamUserRole } from "@langwatch/prisma-client/generated";

export type TeamRoleValue = TeamUserRole | `custom:${string}`;

/**
 * The one sanctioned translation between the two role enums. ADMIN and
 * MEMBER are spelled the same in both, which is exactly why every cast
 * "worked" until the enums diverge — write paths that turn an organization
 * seat into a team/scope binding must go through this map so a future
 * divergence fails the typecheck instead of writing a wrong role. EXTERNAL
 * (a lite member) deliberately lands as VIEWER: a lite seat never confers
 * write access on a scope it is granted into.
 */
export const ORGANIZATION_TO_TEAM_ROLE_MAP: Record<OrganizationUserRole, TeamUserRole> = {
  [OrganizationUserRole.ADMIN]: TeamUserRole.ADMIN,
  [OrganizationUserRole.MEMBER]: TeamUserRole.MEMBER,
  [OrganizationUserRole.EXTERNAL]: TeamUserRole.VIEWER,
} as const;

export function getOrganizationRoleLabel(role: OrganizationUserRole): string {
  if (role === OrganizationUserRole.ADMIN) return "Organization Admin";
  if (role === OrganizationUserRole.MEMBER) return "Organization Member";
  return "Lite Member";
}

export function isTeamRoleAllowedForOrganizationRole(params: {
  organizationRole: OrganizationUserRole;
  teamRole: TeamRoleValue;
}): boolean {
  const { organizationRole, teamRole } = params;

  if (organizationRole === OrganizationUserRole.EXTERNAL) {
    return teamRole === TeamUserRole.VIEWER;
  }

  if (organizationRole === OrganizationUserRole.MEMBER) {
    return teamRole !== TeamUserRole.VIEWER;
  }

  return true;
}

/**
 * Whether an access row (a RoleBinding) may store this role for a member
 * holding this organization role. Only the Lite Member seat constrains stored
 * rows: the seat means viewing only, so the stored role says Viewer too, and
 * a custom role (whose permissions are its own) requires a full seat. The
 * MEMBER-excludes-Viewer rule from team membership does not apply here,
 * because access rows legitimately hold Viewer for full seats — a project row
 * scoping somebody down, for example.
 */
export function isBindingRoleAllowedForOrganizationRole(params: {
  organizationRole: OrganizationUserRole;
  role: TeamRoleValue;
}): boolean {
  const { organizationRole, role } = params;
  if (organizationRole !== OrganizationUserRole.EXTERNAL) return true;
  return isTeamRoleAllowedForOrganizationRole({
    organizationRole,
    teamRole: role,
  });
}

/** The role a fresh team assignment starts from, given the seat. */
export function getDefaultTeamRoleForOrganizationRole(
  organizationRole: OrganizationUserRole,
): TeamUserRole {
  return organizationRole === OrganizationUserRole.EXTERNAL
    ? TeamUserRole.VIEWER
    : TeamUserRole.MEMBER;
}

export function getAutoCorrectedTeamRoleForOrganizationRole(params: {
  organizationRole: OrganizationUserRole;
  currentTeamRole: TeamRoleValue;
}): TeamRoleValue {
  const { organizationRole, currentTeamRole } = params;

  if (organizationRole === OrganizationUserRole.EXTERNAL) {
    return TeamUserRole.VIEWER;
  }

  if (organizationRole === OrganizationUserRole.MEMBER && currentTeamRole === TeamUserRole.VIEWER) {
    return TeamUserRole.MEMBER;
  }

  return currentTeamRole;
}
