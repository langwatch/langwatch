import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { isPreviewTraceId } from "../components/EmptyState/samplePreviewTraces";
import { useDrawerStore } from "../stores/drawerStore";

export function useSpansFull(enabled: boolean) {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const occurredAtMs = useDrawerStore((s) => s.occurredAtMs);

  return api.tracesV2.spansFull.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      ...(occurredAtMs !== null ? { occurredAtMs } : {}),
    },
    {
      enabled:
        enabled &&
        !!project?.id &&
        !!traceId &&
        !isPreviewTraceId(traceId),
      staleTime: 300_000,
      // Hold the span tree in cache for 30 min after the last observer
      // unmounts. Lets users flip between recently-viewed traces in the
      // conversation strip with no loading flash.
      cacheTime: 1_800_000,
      // While the new trace's spans are loading, keep showing the previous
      // trace's spans rather than a skeleton. The visualizer panel pops
      // back instantly when navigating between siblings.
      keepPreviousData: true,
    },
  );
}
