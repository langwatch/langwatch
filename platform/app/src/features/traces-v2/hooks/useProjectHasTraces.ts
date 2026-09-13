import { useEffect } from "react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/** How often the first-trace flag is re-read while the project has none. */
const FIRST_TRACE_POLL_MS = 5_000;

/**
 * Self-stopping poll (see dev/docs/best_practices/async-processing-ui.md):
 * while the project has never received a trace, re-read the flag on a short
 * interval so the page leaves its empty state the moment the first trace
 * lands, with no reload. Stops itself once the flag is true.
 */
export function firstTracePollInterval(
  data: { firstMessage: boolean } | undefined,
): number | false {
  return data?.firstMessage ? false : FIRST_TRACE_POLL_MS;
}

interface ProjectHasTracesResult {
  /**
   * `true` if the project has ever received a trace, `false` if it hasn't,
   * `undefined` while the project context is still loading. Reads off the
   * `firstMessage` flag on the Project model — flipped to `true` by the
   * collector worker / projectMetadata subscriber on first ingest. This is
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
  const utils = api.useUtils();

  // The project record comes from the organization query, which is re-read
  // on focus and on a route change, so on its own it learns of the first
  // trace only when the reader leaves and comes back. While the flag is
  // false, the small dedicated read polls for it instead.
  const waitingForFirstTrace = project?.firstMessage === false;
  const firstTrace = api.project.getHasFirstMessage.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: waitingForFirstTrace,
      refetchOnWindowFocus: false,
      refetchInterval: (query) => firstTracePollInterval(query.state.data),
    },
  );
  const firstTraceArrived =
    waitingForFirstTrace && firstTrace.data?.firstMessage === true;

  // The flag flipped: refresh the shared project record so every other
  // reader of `project.firstMessage` follows, and the poll above ends.
  useEffect(() => {
    if (!firstTraceArrived) return;
    void utils.organization.getAll.invalidate();
  }, [firstTraceArrived, utils]);

  if (!project) return { hasAnyTraces: undefined, isLoading };
  return {
    hasAnyTraces: project.firstMessage || firstTraceArrived,
    isLoading: false,
  };
}
