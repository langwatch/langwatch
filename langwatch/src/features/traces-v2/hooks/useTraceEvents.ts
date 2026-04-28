import { useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";
import { parseOccurredAtMs } from "./useTraceOccurredAt";

export function useTraceEvents() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const eventsExpanded = useDrawerStore((s) => s.eventsExpanded);
  const occurredAtMs = parseOccurredAtMs(useDrawerParams().t);

  return api.tracesV2.events.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
    },
    {
      enabled: !!project?.id && !!traceId && eventsExpanded,
      staleTime: 300_000,
      gcTime: 1_800_000,
    },
  );
}
