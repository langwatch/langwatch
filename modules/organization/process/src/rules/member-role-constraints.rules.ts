import { OrganizationUserRole, TeamUserRole } from "@langwatch/organization-contract";

export type TeamRoleValue = TeamUserRole | `custom:${string}`;

/**
 * The one sanctioned translation between the two role enums. DEVELOPER (ADR-171) is VIEWER,
 * never ADMIN, since an ORGANIZATION-scoped ADMIN binding opens every project; write paths
 * branch on `holdsSharedAccess` first, so a Developer never reaches this entry.
 */
export const ORGANIZATION_TO_TEAM_ROLE_MAP: Record<OrganizationUserRole, TeamUserRole> = {
  [OrganizationUserRole.ADMIN]: TeamUserRole.ADMIN,
  [OrganizationUserRole.MEMBER]: TeamUserRole.MEMBER,
  [OrganizationUserRole.EXTERNAL]: TeamUserRole.VIEWER,
  [OrganizationUserRole.DEVELOPER]: TeamUserRole.VIEWER,
} as const;

/**
 * Whether a seat may hold access on anything the organisation shares: a
 * shared team, a shared project, or the organisation itself. A Developer
 * (ADR-171) may not; their personal team is the only scope they ever hold.
 */
export function holdsSharedAccess(role: OrganizationUserRole): boolean {
  return role !== OrganizationUserRole.DEVELOPER;
}

/**
 * Whether a seat carries the ORGANIZATION-scoped binding a Full member holds.
 * Neither a Lite Member (their access comes from their teams) nor a Developer
 * (ADR-171) does, so the writers of that binding ask this one question.
 */
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

/**
 * Whether a member holding this organization role may hold this role on a
 * SHARED team. A Developer (ADR-171) may hold none: their personal team is
 * the only team they are ever on, and it is never offered here.
 */
export function isTeamRoleAllowedForOrganizationRole(params: {
  organizationRole: OrganizationUserRole;
  teamRole: TeamRoleValue;
}): boolean {
  const { organizationRole, teamRole } = params;

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
  if (organizationRole === OrganizationUserRole.DEVELOPER) {
    return false;
  }

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
