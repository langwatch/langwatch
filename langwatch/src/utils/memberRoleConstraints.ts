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
