import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { LangwatchSignalBucket } from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";
import { isPreviewTraceId } from "../components/EmptyState/samplePreviewTraces";
import { LIVE_REFETCH_MS, LIVE_WINDOW_MS } from "../constants/freshness";
import { useDrawerStore } from "../stores/drawerStore";

/**
 * Secondary signal-detection query for the open drawer trace. Fired in
 * parallel with `useSpanTree` so the cheap waterfall/list payload renders
 * first and the badges + "Only LangWatch spans" filter light up once this
 * resolves. Returns a Map<spanId, signals[]> for O(1) row lookup.
 */
export function useSpanLangwatchSignals() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const occurredAtMs = useDrawerStore((s) => s.occurredAtMs);

  const isLive =
    occurredAtMs !== null && Date.now() - occurredAtMs < LIVE_WINDOW_MS;

  const query = api.tracesV2.spanLangwatchSignals.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      ...(occurredAtMs !== null ? { occurredAtMs } : {}),
    },
    {
      enabled:
        !!project?.id && !!traceId && !isPreviewTraceId(traceId),
      staleTime: 300_000,
      cacheTime: 1_800_000,
      keepPreviousData: true,
      refetchOnWindowFocus: true,
      refetchInterval: isLive ? LIVE_REFETCH_MS : false,
    },
  );

  const signalsBySpanId = useMemo(() => {
    const map = new Map<string, LangwatchSignalBucket[]>();
    for (const row of query.data ?? []) {
      map.set(row.spanId, row.signals);
    }
    return map;
  }, [query.data]);

  return { ...query, signalsBySpanId };
}
