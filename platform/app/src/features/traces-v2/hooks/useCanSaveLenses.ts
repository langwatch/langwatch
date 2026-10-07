import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { isAggregateProjectKind } from "~/server/app-layer/projects/project-kinds";

/**
 * Whether the trace list may save, rename or delete a lens. A lens is a
 * saved view written under the project, and an aggregate project is read only
 * (ADR-144): its server refuses the write, so its toolbar offers none.
 */
export function useCanSaveLenses(): boolean {
  const { project } = useOrganizationTeamProject();
  return !isAggregateProjectKind(project?.kind);
}
