import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";

export function useTraceEvents() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const eventsExpanded = useDrawerStore((s) => s.eventsExpanded);

  return api.tracesV2.events.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
    },
    {
      enabled: !!project?.id && !!traceId && eventsExpanded,
      staleTime: 300_000,
    },
  );
}
