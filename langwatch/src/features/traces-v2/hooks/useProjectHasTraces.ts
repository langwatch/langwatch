import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

interface ProjectHasTracesResult {
  /**
   * `true` if the project has ever received a trace, `false` if it hasn't,
   * `undefined` while the project context is still loading. Reads off the
   * `firstMessage` flag on the Project model — flipped to `true` by the
   * collector worker / projectMetadata reactor on first ingest. This is
   * cheaper and more accurate than probing the trace store.
   *
   * NB: this is "have they ever sent a trace?" — not "do they have a
   * trace in the current view?". The empty-state journey is meant only
   * for the truly-never-sent case; a project that's gone quiet in the
   * last 30 days is a different state with different copy and gets the
   * `EmptyFilterState` ("No traces in this window") instead.
   */
  hasAnyTraces: boolean | undefined;
  isLoading: boolean;
}

export function useProjectHasTraces(): ProjectHasTracesResult {
  const { project, isLoading } = useOrganizationTeamProject();
  if (!project) return { hasAnyTraces: undefined, isLoading };
  return { hasAnyTraces: project.firstMessage, isLoading: false };
}
