import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * User-events ("track" events) attached to a trace via the legacy
 * `/track-event` REST endpoint. Loaded separately from the trace header
 * because they live in the legacy trace doc rather than the v2 fold
 * projection — the drawer's events accordion merges them with the
 * span-level events that come on the header.
 */
export function useTraceUserEvents(traceId: string) {
  const { project } = useOrganizationTeamProject();
  return api.tracesV2.userEvents.useQuery(
    { projectId: project?.id ?? "", traceId },
    {
      enabled: !!project?.id && !!traceId,
      staleTime: 60_000,
    },
  );
}
