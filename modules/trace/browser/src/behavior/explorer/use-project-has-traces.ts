import { isAggregateProjectKind } from "@langwatch/project-contract";

import { useOrganizationTeamProject } from "../use-organization-team-project.ts";

interface ProjectHasTracesResult {
  /**
   * `true` if the project has ever received a trace, `false` if it hasn't, `undefined`
   * while the project context is still loading. An aggregate is never sent a trace and
   * reads its members', so it always counts as having traces.
   */
  hasAnyTraces: boolean | undefined;
  isLoading: boolean;
}

export function useProjectHasTraces(): ProjectHasTracesResult {
  const { project, isLoading } = useOrganizationTeamProject();
  if (!project) return { hasAnyTraces: undefined, isLoading };
  return {
    hasAnyTraces: isAggregateProjectKind(project.kind) || project.firstMessage,
    isLoading: false,
  };
}
