/**
 * The grants a member-role change writes, as the authz grant ceiling checks them.
 */
import { GrantScopeTier } from "@langwatch/authz-contract";
import { OrganizationUserRole } from "@langwatch/organization-contract";

import type { EffectiveTeamRoleUpdate } from "../services/compute-effective-team-role-updates.service.ts";
import type { OrganizationIntendedGrant } from "../services/organization-grant-ceiling.service.ts";
import { ORGANIZATION_TO_TEAM_ROLE_MAP } from "./member-role-constraints.rules.ts";

/** The grants a member-role change writes: the organization role (none if EXTERNAL), then teams. */
export function intendedRoleChangeGrants({
  organizationId,
  role,
  effectiveTeamRoleUpdates,
}: {
  organizationId: string;
  role: OrganizationUserRole;
  effectiveTeamRoleUpdates: EffectiveTeamRoleUpdate[];
}): OrganizationIntendedGrant[] {
  return [
    ...(role === OrganizationUserRole.EXTERNAL
      ? []
      : [
          {
            role: ORGANIZATION_TO_TEAM_ROLE_MAP[role],
            scopeType: GrantScopeTier.ORGANIZATION,
            scopeId: organizationId,
          },
        ]),
    ...effectiveTeamRoleUpdates.map((update) =>
      intendedTeamGrant({
        teamId: update.teamId,
        role: update.role,
        customRoleId: update.customRoleId,
      }),
    ),
  ];
}

/** The team grant a requested role resolves to: a built-in role, or `custom:<id>` with its id. */
export function intendedTeamGrant({
  teamId,
  role,
  customRoleId,
}: {
  teamId: string;
  role: string;
  customRoleId?: string;
}): OrganizationIntendedGrant {
  if (role === "ADMIN" || role === "MEMBER" || role === "VIEWER") {
    return { role, scopeType: GrantScopeTier.TEAM, scopeId: teamId };
  }
  return {
    role: "CUSTOM",
    customRoleId: customRoleId ?? null,
    scopeType: GrantScopeTier.TEAM,
    scopeId: teamId,
  };
}
