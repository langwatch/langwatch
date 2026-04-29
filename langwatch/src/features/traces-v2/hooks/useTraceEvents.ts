import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";

export function useTraceEvents() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const eventsExpanded = useDrawerStore((s) => s.eventsExpanded);
  const occurredAtMs = useDrawerStore((s) => s.occurredAtMs);

  return api.tracesV2.events.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      ...(occurredAtMs !== null ? { occurredAtMs } : {}),
    },
    {
      enabled: !!project?.id && !!traceId && eventsExpanded,
      staleTime: 300_000,
      cacheTime: 1_800_000,
    },
  );
}
