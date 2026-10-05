/** Team role constraints: picker narrowing validated by server before storage. */

import { OrganizationUserRole, TeamUserRole } from "./prisma-types.ts";

export type TeamRoleValue = TeamUserRole | `custom:${string}`;

/**
 * Org-to-team role map: EXTERNAL→VIEWER ensures lite seats have no write access.
 * DEVELOPER has an entry because the record is total over the enum, and it is VIEWER,
 * never ADMIN. Write paths must not reach it for a Developer: `holdsSharedAccess` first.
 */
export const ORGANIZATION_TO_TEAM_ROLE_MAP: Record<OrganizationUserRole, TeamUserRole> = {
  [OrganizationUserRole.ADMIN]: TeamUserRole.ADMIN,
  [OrganizationUserRole.MEMBER]: TeamUserRole.MEMBER,
  [OrganizationUserRole.EXTERNAL]: TeamUserRole.VIEWER,
  [OrganizationUserRole.DEVELOPER]: TeamUserRole.VIEWER,
} as const;

/**
 * Whether a seat may hold access on anything the organisation shares: a shared team,
 * a shared project, or the organisation itself. A Developer may not; their personal
 * team is the only scope they ever hold.
 */
export function holdsSharedAccess(role: OrganizationUserRole): boolean {
  return role !== OrganizationUserRole.DEVELOPER;
}

export function getOrganizationRoleLabel(role: OrganizationUserRole): string {
  if (role === OrganizationUserRole.ADMIN) return "Organization Admin";
  if (role === OrganizationUserRole.MEMBER) return "Organization Member";
  if (role === OrganizationUserRole.DEVELOPER) return "Developer";
  return "Lite Member";
}

export function isTeamRoleAllowedForOrganizationRole(params: {
  organizationRole: OrganizationUserRole;
  teamRole: TeamRoleValue;
}): boolean {
  const { organizationRole, teamRole } = params;

  // A Developer holds no role on a shared team: their personal team is never offered here.
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

/** Check if access row role is allowed for organization role (lite seat constraint). */
export function isGrantRoleAllowedForOrganizationRole(params: {
  organizationRole: OrganizationUserRole;
  role: TeamRoleValue;
}): boolean {
  const { organizationRole, role } = params;
  // A Developer holds no stored row on anything shared, whatever the role.
  if (organizationRole === OrganizationUserRole.DEVELOPER) return false;
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
