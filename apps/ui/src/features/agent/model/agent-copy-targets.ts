/**
 * Which projects an agent may be replicated into, and whether the reader may.
 */

import {
  builtinRoleGrants,
  permissionSatisfiedBy,
  roleKeyForTeamRole,
} from "@langwatch/authz-contract";

/** The grant a replication target is judged by. Agents live under evaluations. */
export const AGENT_COPY_PERMISSION = "evaluations:manage";

/** The organization graph, narrowed to what this decision reads. */
export type AgentCopyOrganization = {
  name: string;
  teams: readonly AgentCopyTeam[];
};

export type AgentCopyTeam = {
  name: string;
  members?: readonly AgentCopyTeamMember[];
  projects: readonly { id: string; name: string }[];
};

export type AgentCopyTeamMember = {
  userId: string;
  role: string;
  assignedRole?: { permissions?: unknown } | null;
};

export type AgentCopyTargetRow = {
  label: string;
  value: string;
  hasCreatePermission: boolean;
};

const TEAM_ROLES = new Set(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);

/**
 * A custom role's own permission list, when it has a non-empty one.
 */
function assignedPermissions(member: AgentCopyTeamMember): readonly string[] | undefined {
  const permissions = member.assignedRole?.permissions;
  if (!Array.isArray(permissions)) return void 0;
  const named = permissions.filter((entry): entry is string => typeof entry === "string");
  return named.length > 0 ? named : void 0;
}

function memberGrants(member: AgentCopyTeamMember, permission: string): boolean {
  const assigned = assignedPermissions(member);
  if (assigned) {
    return permissionSatisfiedBy({ granted: new Set(assigned), requested: permission });
  }
  // An unrecognised legacy role reads as the most restrictive built-in one
  // rather than as an error: the picker greys the row instead of vanishing it.
  const role = TEAM_ROLES.has(member.role) ? member.role : "VIEWER";
  return builtinRoleGrants({
    role: roleKeyForTeamRole(role as "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM"),
    permission,
  });
}

export function agentCopyTargets({
  organizations,
  userId,
  permission = AGENT_COPY_PERMISSION,
}: {
  organizations: readonly AgentCopyOrganization[];
  userId: string | undefined;
  permission?: string;
}): AgentCopyTargetRow[] {
  if (!userId) return [];

  return organizations.flatMap((organization) =>
    organization.teams.flatMap((team) => {
      const member = team.members?.find((candidate) => candidate.userId === userId);
      if (!member) return [];

      const hasCreatePermission = memberGrants(member, permission);
      return team.projects.map((project) => ({
        label: `${organization.name} / ${team.name} / ${project.name}`,
        value: project.id,
        hasCreatePermission,
      }));
    }),
  );
}
