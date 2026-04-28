import { useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";
import { parseOccurredAtMs } from "./useTraceOccurredAt";

export function useSpanDetail() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const spanId = useDrawerStore((s) => s.selectedSpanId);
  const occurredAtMs = parseOccurredAtMs(useDrawerParams().t);

  return api.tracesV2.spanDetail.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      spanId: spanId ?? "",
      ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
    },
    {
      enabled: !!project?.id && !!traceId && !!spanId,
      staleTime: 300_000,
    },
  );
}
