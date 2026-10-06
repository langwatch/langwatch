import { OrganizationUserRole, TeamUserRole } from "@langwatch/organization-contract";

export type TeamRoleValue = TeamUserRole | `custom:${string}`;

/**
 * The one sanctioned translation between the two role enums. DEVELOPER maps to
 * VIEWER only because the record is total; write paths ask `holdsSharedAccess`
 * first and never reach that entry (ADR-171).
 */
export const ORGANIZATION_TO_TEAM_ROLE_MAP: Record<OrganizationUserRole, TeamUserRole> = {
  [OrganizationUserRole.ADMIN]: TeamUserRole.ADMIN,
  [OrganizationUserRole.MEMBER]: TeamUserRole.MEMBER,
  [OrganizationUserRole.EXTERNAL]: TeamUserRole.VIEWER,
  [OrganizationUserRole.DEVELOPER]: TeamUserRole.VIEWER,
} as const;

/** Whether a seat may hold access on anything shared; a Developer may not (ADR-171). */
export function holdsSharedAccess(role: OrganizationUserRole): boolean {
  return role !== OrganizationUserRole.DEVELOPER;
}

/** Whether a seat carries the ORGANIZATION-scoped binding: Full members only. */
export function holdsOrganizationBinding(role: OrganizationUserRole): boolean {
  return role === OrganizationUserRole.ADMIN || role === OrganizationUserRole.MEMBER;
}

export function getOrganizationRoleLabel(role: OrganizationUserRole): string {
  if (role === OrganizationUserRole.ADMIN) {
    return "Organization Admin";
  }

  if (role === OrganizationUserRole.MEMBER) {
    return "Organization Member";
  }

  if (role === OrganizationUserRole.DEVELOPER) {
    return "Developer";
  }

  return "Lite Member";
}

export function isTeamRoleAllowedForOrganizationRole(params: {
  organizationRole: OrganizationUserRole;
  teamRole: TeamRoleValue;
}): boolean {
  const { organizationRole, teamRole } = params;

  // A Developer holds no role on any shared team (ADR-171).
  if (organizationRole === OrganizationUserRole.DEVELOPER) {
    return false;
  }

  if (organizationRole === OrganizationUserRole.EXTERNAL) {
    return teamRole === TeamUserRole.VIEWER;
  }

  if (organizationRole === OrganizationUserRole.MEMBER) {
    return teamRole !== TeamUserRole.VIEWER;
  }

  return true;
}

/**
 * Whether an access row (a RoleBinding) may store this role for a member holding this
 * organization role.
 */
export function isBindingRoleAllowedForOrganizationRole(params: {
  organizationRole: OrganizationUserRole;
  role: TeamRoleValue;
}): boolean {
  const { organizationRole, role } = params;
  // A Developer holds no stored row on anything shared, whatever the role.
  if (organizationRole === OrganizationUserRole.DEVELOPER) return false;
  if (organizationRole !== OrganizationUserRole.EXTERNAL) {
    return true;
  }

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
