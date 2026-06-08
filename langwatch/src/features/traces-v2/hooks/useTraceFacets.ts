import { useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";

const EMPTY: never[] = [];
const EMPTY_RESULT: { facets: never[]; pending: boolean } = {
  facets: EMPTY,
  pending: true,
};

export function useTraceFacets() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const timeRange = useFilterStore((s) => s.debouncedTimeRange);

  // Backoff counter for the cold-miss polling fallback below. Ref because
  // refetchInterval is read by React Query's scheduler outside React's
  // render cycle, and we don't want a state update to retrigger the query.
  const pendingPollAttemptsRef = useRef(0);

  const query = api.tracesV2.discover.useQuery(
    {
      projectId: projectId ?? "",
      timeRange: {
        from: timeRange.from,
        to: timeRange.to,
        live: !!timeRange.label,
      },
    },
    {
      enabled: !!projectId,
      // Discover used to carry a 10-min staleTime because SSE
      // invalidation didn't exist. Dropped to 0: the server's
      // SWR cache + the new `discover_updated` SSE push are the
      // freshness mechanism now, so we always read through to the
      // server-side cache (which is warm) instead of trusting a stale
      // client-side payload.
      staleTime: 0,
      // Keep prior facets visible across time-range / filter refetches so
      // the sidebar doesn't flicker. Project switches are gated below by
      // remembering which project the cached response belongs to.
      keepPreviousData: true,
      // Discover must not batch with `list`: the list query is the slow one
      // on heavy projects (10–30s) and batching makes the sidebar wait the
      // full duration even though discover itself returns in ~2s.
      trpc: { context: { skipBatch: true } },
      // Polling fallback for cold misses: the server returns `pending: true`
      // and kicks an async compute that broadcasts `discover_updated` over
      // SSE when it lands. SSE is the primary settlement path, but if it's
      // missed/delayed/rate-limited or the subscription isn't connected,
      // we'd sit on the synthetic skeleton forever. Poll while pending with
      // 2s/4s/8s/15s backoff so the first warm response always settles.
      // Cleared as soon as a non-pending payload arrives.
      refetchInterval: (data) => {
        if (!data?.pending) {
          pendingPollAttemptsRef.current = 0;
          return false;
        }
        const delay = Math.min(
          2000 * 2 ** pendingPollAttemptsRef.current,
          15000,
        );
        pendingPollAttemptsRef.current += 1;
        return delay;
      },
    },
  );

  // Live `discover_updated` freshness is owned by the single page-level
  // coordinator (useTraceFreshness), not here: useTraceFacets is consumed by
  // several sidebar components and a per-consumer subscription would open a
  // duplicate SSE connection each. The coordinator's one subscription
  // invalidates this shared query, so the cold-miss `refetchInterval` poll
  // below is the only freshness path this hook needs to own.

  // keepPreviousData is project-blind — without this guard it would surface
  // project A's facets while project B's discover request is in flight.
  // Record the project id of the most recent fresh (non-previous) response,
  // and treat anything older as a loading state.
  const dataProjectIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (query.isSuccess && !query.isPreviousData) {
      dataProjectIdRef.current = projectId;
    }
  }, [query.isSuccess, query.isPreviousData, projectId]);

  const isFromOtherProject = dataProjectIdRef.current !== projectId;

  // Cold-miss responses come back with `pending: true` and an empty
  // facets array — treat that as still-loading so the FilterSidebar
  // keeps rendering the FACET_DEFAULTS skeleton (gated on `isLoading`)
  // until the real payload lands (via the SSE-driven invalidation, or
  // the `refetchInterval` poll above when SSE is delayed/missed).
  // Without this, the sidebar would flash empty for the 1–2s ClickHouse
  // scan.
  const result = isFromOtherProject ? EMPTY_RESULT : (query.data ?? EMPTY_RESULT);

  return {
    data: result.facets,
    isLoading: query.isLoading || isFromOtherProject || result.pending,
  };
}
