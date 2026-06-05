import { useEffect, useMemo, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFilterStore } from "../stores/filterStore";
import {
  type DiscoverDescriptors,
  getCachedDiscover,
  setCachedDiscover,
} from "./discoverCache";

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

  // "Other project" only fires when there *was* a previous fresh
  // response and its project no longer matches — initial mount (ref
  // still undefined) doesn't count. Without this, the cache below would
  // be skipped on every cold page load because the guard would treat
  // the very first render as a project mismatch.
  const isFromOtherProject =
    dataProjectIdRef.current !== undefined &&
    dataProjectIdRef.current !== projectId;

  // Persist successful (non-pending, non-stale) discover payloads to
  // localStorage so subsequent visits can render the sidebar from the
  // last known shape immediately. Writes happen on the success edge
  // only; we don't bother caching `{ pending: true }` placeholders.
  useEffect(() => {
    if (!projectId) return;
    if (!query.isSuccess || query.isPreviousData) return;
    if (!query.data || query.data.pending) return;
    setCachedDiscover(projectId, query.data.facets);
  }, [projectId, query.isSuccess, query.isPreviousData, query.data]);

  // Warm-start: hand the sidebar the previous session's descriptors so
  // it renders something USEFUL (real keys + real labels, not a
  // count-less synthesised stub) on first paint. The live query still
  // runs in the background and replaces this once it lands, with the
  // same row identities so the swap is invisible when the shape hasn't
  // drifted.
  const cachedFacets = useMemo<DiscoverDescriptors | null>(
    () => (projectId ? getCachedDiscover(projectId) : null),
    [projectId],
  );

  // Resolution order:
  //   1. Stale-project guard with no cache for the new project — show
  //      the skeleton (EMPTY_RESULT) so we don't bleed project A's
  //      payload into project B's render. If the new project HAS a
  //      cache hit we keep the warm start; the cache lookup above is
  //      already scoped to the new project id.
  //   2. Fresh, settled (non-pending) live data wins next.
  //   3. Warm cache from a previous session bridges the gap while the
  //      live request is in flight.
  //   4. Fall through to the live response (which may still be
  //      `pending: true` and empty) so the existing skeleton / pending
  //      branch keeps firing for genuinely first-time users.
  const liveSettled =
    query.data && !query.data.pending ? query.data : undefined;
  const result =
    isFromOtherProject && !cachedFacets
      ? EMPTY_RESULT
      : liveSettled
        ? liveSettled
        : cachedFacets
          ? { facets: cachedFacets, pending: false }
          : (query.data ?? EMPTY_RESULT);

  // Loading reflects what the sidebar will see: if there's either
  // live or cached data driving `result`, the operator already has a
  // useful sidebar so `isLoading` is false. Only first-time visitors
  // — or a project switch into a project we've never visited — see
  // `isLoading: true` and the skeleton it triggers downstream.
  const haveUsableData = liveSettled || cachedFacets;
  const isLoading = haveUsableData
    ? false
    : query.isLoading || isFromOtherProject || result.pending;

  return {
    data: result.facets,
    isLoading,
  };
}
