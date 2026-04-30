import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { isPreviewTraceId } from "../components/EmptyState/samplePreviewTraces";
import { useDrawerStore } from "../stores/drawerStore";

export function useSpanDetail() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const spanId = useDrawerStore((s) => s.selectedSpanId);
  const occurredAtMs = useDrawerStore((s) => s.occurredAtMs);

  return api.tracesV2.spanDetail.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      spanId: spanId ?? "",
      ...(occurredAtMs !== null ? { occurredAtMs } : {}),
    },
    {
      enabled:
        !!project?.id &&
        !!traceId &&
        !!spanId &&
        !isPreviewTraceId(traceId),
      staleTime: 300_000,
    },
  );
}
