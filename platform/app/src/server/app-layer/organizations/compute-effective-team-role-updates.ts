import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import type { TeamRoleValue } from "~/utils/memberRoleConstraints";

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
 * Who asked for this update: the caller, naming the team and the role outright,
 * or the seat change, correcting a role the new organization role no longer
 * allows.
 *
 * The difference decides what happens when the update would take away a team's
 * only admin. A caller who named the team is refused, because they asked for a
 * team-local change and a team needs an admin. A seat correction goes through
 * and is reported back: it is the organization deciding what one person's seat
 * is, an ORGANIZATION-scoped ADMIN binding still administers every shared team,
 * and refusing used to take the whole seat change down with it.
 */
export type TeamRoleUpdateOrigin = "requested" | "seat-correction";

export type EffectiveTeamRoleUpdate = TeamRoleUpdate & {
  origin: TeamRoleUpdateOrigin;
};

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
}): EffectiveTeamRoleUpdate[] {
  const { requestedTeamRoleUpdates, currentMemberships, newOrganizationRole } =
    params;

  const requested = requestedTeamRoleUpdates.map(
    (update): EffectiveTeamRoleUpdate => ({ ...update, origin: "requested" }),
  );
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

    const requestedTeamIdSet = new Set(
      requested.map((update) => update.teamId),
    );
    return [
      ...requested,
      ...correctTo(
        currentMemberships.filter(
          (membership) => !requestedTeamIdSet.has(membership.teamId),
        ),
        TeamUserRole.VIEWER,
      ),
    ];
  }

  if (newOrganizationRole === OrganizationUserRole.EXTERNAL) {
    return correctTo(
      currentMemberships.filter(
        (membership) => membership.role !== TeamUserRole.VIEWER,
      ),
      TeamUserRole.VIEWER,
    );
  }

  if (newOrganizationRole === OrganizationUserRole.MEMBER) {
    return correctTo(
      currentMemberships.filter(
        (membership) => membership.role === TeamUserRole.VIEWER,
      ),
      TeamUserRole.MEMBER,
    );
  }

  return [];
}
