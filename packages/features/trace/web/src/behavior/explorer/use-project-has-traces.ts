import { useOrganizationTeamProject } from "../use-organization-team-project";

interface ProjectHasTracesResult {
  /**
   * `true` if the project has ever received a trace, `false` if it hasn't, `undefined`
   * while the project context is still loading.
   */
  hasAnyTraces: boolean | undefined;
  isLoading: boolean;
}

export function useProjectHasTraces(): ProjectHasTracesResult {
  const { project, isLoading } = useOrganizationTeamProject();
  if (!project) return { hasAnyTraces: undefined, isLoading };
  return { hasAnyTraces: project.firstMessage, isLoading: false };
}
