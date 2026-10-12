import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * The name to show for the member project a row on an aggregate project was
 * listed from (ADR-144). Read from the projects the viewer already has loaded,
 * which for the aggregate's admin is every project of the organisation; the id
 * stands in when the name is not among them, so a row is never unattributed.
 */
export function memberProjectName({
  projectId,
  projects,
}: {
  projectId: string;
  projects: readonly { id: string; name: string }[];
}): string {
  return (
    projects.find((project) => project.id === projectId)?.name ?? projectId
  );
}

/** {@link memberProjectName} for the viewer's loaded projects. */
export function useMemberProjectName(
  projectId: string | null | undefined,
): string | null {
  const { organization } = useOrganizationTeamProject();
  const projects = useMemo(
    () => organization?.teams.flatMap((team) => team.projects) ?? [],
    [organization],
  );
  if (!projectId) return null;
  return memberProjectName({ projectId, projects });
}
