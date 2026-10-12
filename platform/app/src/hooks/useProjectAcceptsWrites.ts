import { isAggregateProjectKind } from "~/server/app-layer/projects/project-kinds";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

/**
 * Whether the current project takes writes under it: false on an aggregate
 * project, which is read only (ADR-144 decision 8), true everywhere else.
 *
 * This is the project half of the rule `hasPermission` applies, for a control
 * that has to stay offered to a member without the grant, so that clicking it
 * can explain the restriction, or for a write declared under a read permission
 * (a saved view or lens is declared under `traces:view`). A control that should
 * simply vanish without the grant asks `hasPermission`, which already refuses
 * a project-tier write on an aggregate.
 */
export function useProjectAcceptsWrites(): boolean {
  const { project } = useOrganizationTeamProject();
  return !isAggregateProjectKind(project?.kind);
}
