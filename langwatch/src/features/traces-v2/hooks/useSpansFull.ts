import { useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";
import { parseOccurredAtMs } from "./useTraceOccurredAt";

export function useSpansFull(enabled: boolean) {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const occurredAtMs = parseOccurredAtMs(useDrawerParams().t);

  return api.tracesV2.spansFull.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
    },
    {
      enabled: enabled && !!project?.id && !!traceId,
      staleTime: 300_000,
    },
  );
}
