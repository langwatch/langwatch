import { permissionSatisfiedBy } from "@langwatch/authz";
import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";

export type CopyTargetProject = {
  label: string;
  value: string;
  hasCreatePermission: boolean;
};

/**
 * Permission used to filter which projects appear as copy targets.
 * - evaluations:manage: agents, evaluators
 * - prompts:create: prompts
 * - workflows:create: workflows
 */
export type CopyTargetPermission =
  | "datasets:create"
  | "evaluations:manage"
  | "prompts:create"
  | "workflows:create";

/**
 * Returns a memoized list of projects the current user can copy to,
 * with permission flags for the given permission (default: evaluations:manage).
 */
export function useProjectsForCopy(
  permission: CopyTargetPermission = "evaluations:manage",
): CopyTargetProject[] {
  const { organizations } = useOrganizationTeamProject();
  const session = useRequiredSession();
  const currentUserId = session.data?.user?.id;

  const projects = useMemo(() => {
    if (!organizations) return [];

    return organizations.flatMap((org) =>
      org.teams.flatMap((team) => {
        if (!team.members.some((member) => member.userId === currentUserId))
          return [];

        return team.projects.map((proj) => ({
          label: `${org.name} / ${team.name} / ${proj.name}`,
          value: proj.id,
        }));
      }),
    );
  }, [organizations, currentUserId]);

  const permissionQueries = api.useQueries((t) =>
    projects.map((project) =>
      t.authz.effectivePermissions(
        { projectId: project.value },
        { staleTime: 30_000, refetchOnWindowFocus: true },
      ),
    ),
  );

  return useMemo(
    () =>
      projects.map((project, index) => ({
        ...project,
        hasCreatePermission: permissionSatisfiedBy({
          granted: new Set(permissionQueries[index]?.data?.permissions),
          requested: permission,
        }),
      })),
    [permission, permissionQueries, projects],
  );
}
