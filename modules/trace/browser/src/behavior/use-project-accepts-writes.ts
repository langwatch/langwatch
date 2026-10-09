import { projectKindAcceptsWrites } from "@langwatch/project-contract";

import { useOrganizationTeamProject } from "./use-organization-team-project.ts";

/**
 * Whether the current project takes writes: false on an aggregate (ADR-175
 * decision 8). For a write declared under a read permission (a lens, under
 * `traces:view`), which `hasPermission` cannot refuse on its own.
 */
export function useProjectAcceptsWrites(): boolean {
  const { project } = useOrganizationTeamProject();
  return projectKindAcceptsWrites(project?.kind);
}
