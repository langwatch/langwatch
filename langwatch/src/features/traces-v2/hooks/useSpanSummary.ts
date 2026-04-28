import { useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";
import { parseOccurredAtMs } from "./useTraceOccurredAt";

const LIVE_WINDOW_MS = 3 * 60 * 1000;
const LIVE_REFETCH_MS = 10_000;

export function useSpanTree() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const occurredAtMs = parseOccurredAtMs(useDrawerParams().t);

  // Match useTraceHeader's liveness behaviour so spans + header refresh
  // together as new spans arrive on a recent trace.
  const isLive =
    occurredAtMs !== undefined && Date.now() - occurredAtMs < LIVE_WINDOW_MS;

  return api.tracesV2.spanTree.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
    },
    {
      enabled: !!project?.id && !!traceId,
      staleTime: 300_000,
      gcTime: 1_800_000,
      keepPreviousData: true,
      refetchOnWindowFocus: true,
      refetchInterval: isLive ? LIVE_REFETCH_MS : false,
    },
  );
}
