import { OrganizationUserRole, TeamUserRole } from "@prisma/client";

export type TeamRoleValue = TeamUserRole | `custom:${string}`;

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

  if (
    organizationRole === OrganizationUserRole.MEMBER &&
    currentTeamRole === TeamUserRole.VIEWER
  ) {
    return TeamUserRole.MEMBER;
  }

  return currentTeamRole;
}
