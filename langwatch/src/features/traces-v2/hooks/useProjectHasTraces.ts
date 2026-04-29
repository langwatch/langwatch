import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

interface ProjectHasTracesResult {
  /**
   * `true` if the project has ever received a trace, `false` if it hasn't,
   * `undefined` while the project context is still loading. Reads off the
   * `firstMessage` flag on the Project model — flipped to `true` by the
   * collector worker / projectMetadata reactor on first ingest. This is
   * cheaper and more accurate than probing the trace store.
   */
  hasAnyTraces: boolean | undefined;
  isLoading: boolean;
}

export function useProjectHasTraces(): ProjectHasTracesResult {
  const { project, isLoading } = useOrganizationTeamProject();
  if (!project) return { hasAnyTraces: undefined, isLoading };
  return { hasAnyTraces: project.firstMessage, isLoading: false };
}
