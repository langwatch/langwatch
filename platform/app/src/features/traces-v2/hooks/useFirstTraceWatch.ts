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

/**
 * Watches for the project's first trace while the Trace Explorer is open.
 *
 * `useProjectHasTraces` reads `project.firstMessage` off the organization
 * query, which is re-read on focus and on a route change, so on its own it
 * learns of the first trace only when the reader leaves and comes back.
 * Mounted once by the page: while the flag is false this polls the small
 * dedicated read, and the moment it flips it refreshes the shared project
 * record so every reader of the flag follows and the poll ends.
 */
export function useFirstTraceWatch(): void {
  const { project } = useOrganizationTeamProject();
  const utils = api.useUtils();

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

  useEffect(() => {
    if (!firstTraceArrived) return;
    void utils.organization.getAll.invalidate();
  }, [firstTraceArrived, utils]);
}
