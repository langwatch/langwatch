/**
 * Which projects a thing may be replicated into, for any family that offers it.
 *
 * `platform/app/src/hooks/useProjectsForCopy.ts` answered this by importing
 * `~/server/api/rbac` into a browser hook — `hasPermissionWithHierarchy` for a
 * custom role's own permission list, `teamRoleHasPermission` for the built-in
 * team roles. `apps/ui` may not reach `~/server`, and it does not have to:
 * `@langwatch/authz-contract` publishes both answers, and its roles module says
 * in its own docblock that they are parity-tested against the rbac pair this
 * replaces.
 *
 * THE AGENTS, PROMPTS AND DATASETS FAMILIES EACH WROTE THIS OUT PRIVATELY, and
 * this move needed it for TWO more families at once. Authoring a fourth and a
 * fifth identical copy in one commit is not recording a duplication, it is
 * creating one, so the derivation lives in the global model instead: a private
 * frontend feature may import a global layer, and only the reverse is refused.
 * The three existing private copies are untouched — repointing them is a change
 * to three other families' code that a page move does not own — and this is the
 * module to fold them into.
 *
 * THE PERMISSION IS PER TEAM, NOT PER PAGE, which is why the session
 * capability's `hasPermission` is the wrong question here: it answers for the
 * scope the reader is standing in, and this list offers every project in every
 * organization they belong to. A team the reader holds no membership row in
 * contributes no projects at all.
 *
 * A CLOSED PROJECT IS STILL LISTED, carrying `canCreate: false`, because the
 * two dialogs this serves grey their unreachable rows and say why —
 * `ReplicateToProjectDialog`'s behaviour, which both moved screens keep. A
 * caller that wants the shorter list filters it.
 */

import {
  builtinRoleGrants,
  permissionSatisfiedBy,
  roleKeyForTeamRole,
} from "@langwatch/authz-contract";

/** The organization graph, narrowed to what this decision reads. */
export type UiCopyOrganization = {
  name: string;
  teams: readonly UiCopyTeam[];
};

export type UiCopyTeam = {
  name: string;
  members?: readonly UiCopyTeamMember[];
  projects: readonly { id: string; name: string }[];
};

export type UiCopyTeamMember = {
  userId: string;
  role: string;
  assignedRole?: { permissions?: unknown } | null;
};

export type UiCopyTargetRow = {
  id: string;
  /** "Organization / Team / Project", as both replication selects render it. */
  name: string;
  canCreate: boolean;
};

const TEAM_ROLES = new Set(["ADMIN", "MEMBER", "VIEWER", "CUSTOM"]);

/**
 * A custom role's own permission list, when it has a non-empty one.
 *
 * The column is JSON, so a row that has never been edited arrives as `null` and
 * a legacy row can arrive as anything. Only an array of strings is a permission
 * list; everything else falls through to the built-in role, which is what the
 * platform hook did when `permissions.length === 0`.
 */
function assignedPermissions(member: UiCopyTeamMember): readonly string[] | undefined {
  const permissions = member.assignedRole?.permissions;
  if (!Array.isArray(permissions)) return void 0;
  const named = permissions.filter((entry): entry is string => typeof entry === "string");
  return named.length > 0 ? named : void 0;
}

function memberGrants(member: UiCopyTeamMember, permission: string): boolean {
  const assigned = assignedPermissions(member);
  if (assigned) {
    return permissionSatisfiedBy({ granted: new Set(assigned), requested: permission });
  }
  // An unrecognised legacy role reads as the most restrictive built-in one
  // rather than as an error: the row is offered as closed instead of offered as
  // a target the server would then refuse.
  const role = TEAM_ROLES.has(member.role) ? member.role : "VIEWER";
  return builtinRoleGrants({
    role: roleKeyForTeamRole(role as "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM"),
    permission,
  });
}

export function uiCopyTargets({
  organizations,
  userId,
  permission,
}: {
  organizations: readonly UiCopyOrganization[];
  userId: string | undefined;
  permission: string;
}): UiCopyTargetRow[] {
  if (!userId) return [];

  return organizations.flatMap((organization) =>
    organization.teams.flatMap((team) => {
      const member = team.members?.find((candidate) => candidate.userId === userId);
      if (!member) return [];
      const canCreate = memberGrants(member, permission);

      return team.projects.map((project) => ({
        id: project.id,
        name: `${organization.name} / ${team.name} / ${project.name}`,
        canCreate,
      }));
    }),
  );
}
