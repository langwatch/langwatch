import { GrantScopeTier, type AuthzBindingForSynthesis } from "@langwatch/authz-contract";
import type { OrganizationUser, TeamUserRole } from "@langwatch/organization-contract";
import { nowInstant, toDate } from "@langwatch/time";

type TeamMembershipLike = {
  userId: string;
  teamId: string;
  role: TeamUserRole;
  assignedRoleId: string | null;
  assignedRole?: unknown;
  createdAt: OrganizationUser["createdAt"];
  updatedAt: OrganizationUser["updatedAt"];
};

/**
 * A team enriched with a synthesized member entry for the given user if they have a
 * RoleBinding for this team or one of its projects but no TeamUser row yet.
 */
export function enrichTeamWithGrants<
  T extends {
    members: TeamMembershipLike[];
    id: string;
    projects: { id: string }[];
  },
>({
  team,
  userId,
  userGrants,
  organizationId,
}: {
  team: T;
  userId: string;
  userGrants: AuthzBindingForSynthesis[];
  organizationId: string;
}): T {
  const teamProjectIds = new Set(team.projects.map((p) => p.id));
  // TEAM scope takes precedence over PROJECT scope so the synthesized role is
  // deterministic when a user has both kinds of binding for the same team.
  const teamBinding = userGrants.find(
    (b) =>
      b.organizationId === organizationId &&
      b.scopeType === GrantScopeTier.TEAM &&
      b.scopeId === team.id,
  );
  const projectBinding = teamBinding
    ? undefined
    : userGrants.find(
        (b) =>
          b.organizationId === organizationId &&
          b.scopeType === GrantScopeTier.PROJECT &&
          teamProjectIds.has(b.scopeId),
      );
  const binding = teamBinding ?? projectBinding;
  if (!binding) {
    return team;
  }

  const bindingMember = {
    userId,
    teamId: team.id,
    role: binding.role,
    assignedRoleId: binding.customRoleId ?? null,
    assignedRole: binding.customRole ?? null,
    createdAt: toDate(nowInstant()),
    updatedAt: toDate(nowInstant()),
  };
  const existingIndex = team.members.findIndex((m) => m.userId === userId);
  const newMembers =
    existingIndex >= 0
      ? team.members.map((m, i) => (i === existingIndex ? bindingMember : m))
      : [...team.members, bindingMember];

  return { ...team, members: newMembers };
}
