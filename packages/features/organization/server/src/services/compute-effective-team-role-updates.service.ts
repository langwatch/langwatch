import { OrganizationUserRole, TeamUserRole } from "@langwatch/organization-contract";
import type { TeamRoleValue } from "../rules/member-role-constraints.rules";

export const LITE_MEMBER_VIEWER_ONLY_ERROR = "Lite Member users can only have Viewer team role";

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
 * Who asked for this update: the caller, naming the team and the role outright, or the seat
 * change, correcting a role the new organization role no longer allows. The difference decides
 * what happens when the update would take away a team's only admin.
 */
export type TeamRoleUpdateOrigin = "requested" | "seat-correction";

export type EffectiveTeamRoleUpdate = TeamRoleUpdate & {
  origin: TeamRoleUpdateOrigin;
};

/** The team-role changes a membership edit really makes, seat corrections included. */
export class EffectiveTeamRoleUpdatesService {
  static create(): EffectiveTeamRoleUpdatesService {
    return new EffectiveTeamRoleUpdatesService();
  }

  private constructor() {}

  /**
   * The effective set of team role updates to apply when changing a member's organization role.
   * Cases: 1. Requested updates present + non-EXTERNAL org role: use requested updates as-is.
   * 2.
   */
  computeEffectiveTeamRoleUpdates(params: {
    requestedTeamRoleUpdates: TeamRoleUpdate[];
    currentMemberships: CurrentTeamMembership[];
    newOrganizationRole: OrganizationUserRole;
  }): EffectiveTeamRoleUpdate[] {
    const { requestedTeamRoleUpdates, currentMemberships, newOrganizationRole } = params;

    const requested = requestedTeamRoleUpdates.map((update): EffectiveTeamRoleUpdate => ({
      ...update,
      origin: "requested",
    }));
    const correctTo = (
      memberships: CurrentTeamMembership[],
      role: TeamUserRole,
    ): EffectiveTeamRoleUpdate[] =>
      memberships.map((membership) => ({
        teamId: membership.teamId,
        role,
        customRoleId: undefined,
        origin: "seat-correction",
      }));

    if (requested.length > 0) {
      if (newOrganizationRole !== OrganizationUserRole.EXTERNAL) {
        return requested;
      }

      const requestedTeamIdSet = new Set(requested.map((update) => update.teamId));

      return [
        ...requested,
        ...correctTo(
          currentMemberships.filter((membership) => !requestedTeamIdSet.has(membership.teamId)),
          TeamUserRole.VIEWER,
        ),
      ];
    }

    if (newOrganizationRole === OrganizationUserRole.EXTERNAL) {
      return correctTo(
        currentMemberships.filter((membership) => membership.role !== TeamUserRole.VIEWER),
        TeamUserRole.VIEWER,
      );
    }

    if (newOrganizationRole === OrganizationUserRole.MEMBER) {
      return correctTo(
        currentMemberships.filter((membership) => membership.role === TeamUserRole.VIEWER),
        TeamUserRole.MEMBER,
      );
    }

    return [];
  }
}
