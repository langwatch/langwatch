import { GrantScopeTier, type AuthzBindingForSynthesis } from "@langwatch/authz-contract";
import type { ScopeGraphOrganization, ScopeGraphTeam } from "@langwatch/organization-contract";

import { userCanOpenTeam } from "./team-visibility.rules.ts";

/**
 * One organization of the scope graph as its caller sees it: the same narrowing
 * `organization.getAll` applies (organization-visibility.service.ts #narrowToViewer),
 * over rows already holding only the caller's own membership rows.
 */
export function narrowScopeGraphToViewer({
  organization,
  userId,
  bindings,
}: {
  organization: ScopeGraphOrganization;
  userId: string;
  bindings: readonly AuthzBindingForSynthesis[];
}): ScopeGraphOrganization {
  const own = bindings.filter((binding) => binding.organizationId === organization.id);
  // An organization-scoped ADMIN binding is authoritative over a stale member row.
  const adminByBinding = own.some(
    (binding) => binding.scopeType === GrantScopeTier.ORGANIZATION && binding.role === "ADMIN",
  );
  const members = adminByBinding ? [{ role: "ADMIN" }] : organization.members;
  const organizationRole = members[0]?.role;

  const teams = organization.teams
    .map((team) => withBindingMember({ team, userId, bindings: own }))
    .filter((team) => userCanOpenTeam({ team, userId, organizationRole }));

  return { ...organization, members, teams };
}

/** A team-scoped binding, or a project-scoped one on its projects, is a membership. */
function withBindingMember({
  team,
  userId,
  bindings,
}: {
  team: ScopeGraphTeam;
  userId: string;
  bindings: readonly AuthzBindingForSynthesis[];
}): ScopeGraphTeam {
  if (team.members.some((member) => member.userId === userId)) return team;

  const projectIds = new Set(team.projects.map((project) => project.id));
  const reached = bindings.some(
    (binding) =>
      (binding.scopeType === GrantScopeTier.TEAM && binding.scopeId === team.id) ||
      (binding.scopeType === GrantScopeTier.PROJECT && projectIds.has(binding.scopeId)),
  );

  return reached ? { ...team, members: [{ userId }] } : team;
}
