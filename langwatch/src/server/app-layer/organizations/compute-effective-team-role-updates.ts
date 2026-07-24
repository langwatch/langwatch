import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { type TeamRoleValue } from "~/utils/memberRoleConstraints";

export const LITE_MEMBER_VIEWER_ONLY_ERROR =
  "Lite Member users can only have Viewer team role";

export interface TeamRoleUpdate {
  teamId: string;
  role: TeamRoleValue;
  customRoleId?: string;
}

export interface CurrentTeamMembership {
  teamId: string;
  role: TeamUserRole;
}

/**
 * Computes the effective set of team role updates to apply when changing a
 * member's organization role.
 *
 * Cases:
 * 1. Requested updates present + non-EXTERNAL org role: use requested updates as-is.
 * 2. Requested updates present + EXTERNAL org role: use requested updates plus
 *    fallback any uncovered existing memberships to VIEWER.
 * 3. No requested updates + EXTERNAL org role: auto-correct all non-VIEWER
 *    memberships to VIEWER.
 * 4. No requested updates + MEMBER org role: auto-upgrade all VIEWER
 *    memberships to MEMBER.
 * 5. No requested updates + other org role (e.g. ADMIN): no changes needed.
 */
export function computeEffectiveTeamRoleUpdates(params: {
  requestedTeamRoleUpdates: TeamRoleUpdate[];
  currentMemberships: CurrentTeamMembership[];
  newOrganizationRole: OrganizationUserRole;
}): TeamRoleUpdate[] {
  const { requestedTeamRoleUpdates, currentMemberships, newOrganizationRole } =
    params;

  if (requestedTeamRoleUpdates.length > 0) {
    if (newOrganizationRole !== OrganizationUserRole.EXTERNAL) {
      return requestedTeamRoleUpdates;
    }

    const requestedTeamIdSet = new Set(
      requestedTeamRoleUpdates.map((update) => update.teamId),
    );
    const externalFallbackUpdates = currentMemberships
      .filter((membership) => !requestedTeamIdSet.has(membership.teamId))
      .map((membership) => ({
        teamId: membership.teamId,
        role: TeamUserRole.VIEWER,
        customRoleId: undefined,
      }));

    return [...requestedTeamRoleUpdates, ...externalFallbackUpdates];
  }

  if (newOrganizationRole === OrganizationUserRole.EXTERNAL) {
    return currentMemberships
      .filter((membership) => membership.role !== TeamUserRole.VIEWER)
      .map((membership) => ({
        teamId: membership.teamId,
        role: TeamUserRole.VIEWER,
        customRoleId: undefined,
      }));
  }

  if (newOrganizationRole === OrganizationUserRole.MEMBER) {
    return currentMemberships
      .filter((membership) => membership.role === TeamUserRole.VIEWER)
      .map((membership) => ({
        teamId: membership.teamId,
        role: TeamUserRole.MEMBER,
        customRoleId: undefined,
      }));
  }

  return [];
}
