import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { isPreviewTraceId } from "../components/EmptyState/samplePreviewTraces";
import { LIVE_REFETCH_MS, LIVE_WINDOW_MS } from "../constants/freshness";
import { useDrawerStore } from "../stores/drawerStore";

export function useSpanTree() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const occurredAtMs = useDrawerStore((s) => s.occurredAtMs);

  // Match useTraceHeader's liveness behaviour so spans + header refresh
  // together as new spans arrive on a recent trace.
  const isLive =
    occurredAtMs !== null && Date.now() - occurredAtMs < LIVE_WINDOW_MS;

  return api.tracesV2.spanTree.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      ...(occurredAtMs !== null ? { occurredAtMs } : {}),
    },
    {
      // Disable the real tRPC fetch when the traceId is a
      // preview-mode synthetic — `useOpenTraceDrawer` has already
      // seeded the cache with hand-crafted span data; firing a real
      // request would just return empty and clobber the seed.
      enabled:
        !!project?.id && !!traceId && !isPreviewTraceId(traceId),
      staleTime: 300_000,
      cacheTime: 1_800_000,
      keepPreviousData: true,
      refetchOnWindowFocus: true,
      refetchInterval: isLive ? LIVE_REFETCH_MS : false,
    },
  );
}
