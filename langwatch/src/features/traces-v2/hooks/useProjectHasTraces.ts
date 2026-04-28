import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

interface ProjectHasTracesResult {
  /**
   * `true` if the project has at least one trace anywhere in the last
   * decade. `false` if it has none. `undefined` while we're still
   * loading (callers should treat this as "don't decide yet").
   */
  hasAnyTraces: boolean | undefined;
  isLoading: boolean;
}

/**
 * Detects whether the active project has *ever* received a trace,
 * independent of the user's current filter or rolling time range.
 *
 * The trace view's main list query is scoped by both filter and
 * time range, so a query like `status:error` returning zero results
 * doesn't mean the project is empty — only that nothing matches.
 * For deciding whether to show the onboarding empty state we need
 * the project-wide signal.
 *
 * Implementation: probe the standard list endpoint with no filter,
 * a 10-year window, and pageSize 1. ClickHouse short-circuits as
 * soon as it finds a row. The query is keyed on the project id, so
 * tRPC caches it and other consumers don't re-pay the round trip.
 */
export function useProjectHasTraces(): ProjectHasTracesResult {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  // Pin "now" once at the call site so the cache key is stable across
  // re-renders. We don't actually care about freshness on the boundary —
  // 10 years includes "right now" with a wide enough margin that the
  // exact `to` value doesn't change the answer.
  const to = useStableNow();
  const from = to - TEN_YEARS_MS;

  const query = api.tracesV2.list.useQuery(
    {
      projectId: projectId ?? "",
      timeRange: { from, to },
      sort: { columnId: "timestamp", direction: "desc" },
      page: 1,
      pageSize: 1,
    },
    {
      enabled: !!projectId,
      // Once we know the project has traces we don't need to re-check —
      // it's a one-way transition. tRPC's default stale time is fine
      // for the false→true direction (e.g. new sample data lands).
      staleTime: 60_000,
      // Keep the answer cached across remounts so the empty state
      // doesn't flicker on navigation.
      cacheTime: 5 * 60_000,
    },
  );

  return {
    hasAnyTraces: query.data ? query.data.items.length > 0 : undefined,
    isLoading: query.isLoading,
  };
}

import { useRef } from "react";

/**
 * `Date.now()` pinned to the first render so query keys don't drift
 * every render and trigger refetches.
 */
function useStableNow(): number {
  const ref = useRef<number | null>(null);
  if (ref.current === null) ref.current = Date.now();
  return ref.current;
}
