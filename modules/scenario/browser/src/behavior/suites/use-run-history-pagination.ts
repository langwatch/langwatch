/**
 * Cursor-based pagination for suite run history, on tRPC's infinite query.
 *
 * The input minus the cursor keys the query, so a period change starts over by itself.
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { scenarioClient } from "@langwatch/scenario-client";
import { useCallback, useMemo } from "react";

import { useSuiteRunFreshness } from "./use-suite-run-freshness.ts";

interface UseRunHistoryPaginationOptions {
  scenarioSetId?: string;
  startDateMs: number;
  /** While the SSE stream is connected, fallback freshness polling stops. */
  sseConnected?: boolean;
}

/**
 * Deliberately sends no upper bound and no `sinceTimestamp`, so the server never
 * answers `changed: false`; a page that did would carry no runs and is skipped.
 */
export function useRunHistoryPagination({
  scenarioSetId,
  startDateMs,
  sseConnected = false,
}: UseRunHistoryPaginationOptions) {
  const { project } = useOrganizationTeamProject();

  const { data, isLoading, error, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    scenarioClient.scenarios.getSuiteRunData.useInfiniteQuery(
      {
        projectId: project?.id ?? "",
        scenarioSetId,
        limit: 20,
        startDate: startDateMs,
      },
      {
        enabled: !!project,
        getNextPageParam: (last) => (last.changed && last.hasMore ? last.nextCursor : undefined),
        // No timer on the heavy query: SSE invalidations and the freshness
        // probe below drive refetches, so quiet sets never re-download runs.
      },
    );

  const pages = useMemo(() => data?.pages.flatMap((p) => (p.changed ? [p] : [])) ?? [], [data]);

  // Stored status is the only truth: stalled runs are finished ERROR by the
  // process-manager stall watchdog and arrive here via the event broadcast
  // refetch, so no client-side stall re-check is needed.
  const allRuns = useMemo(() => pages.flatMap((p) => p.runs), [pages]);

  // Cheap freshness probe, only while the user hasn't paginated past the first page.
  useSuiteRunFreshness({
    scenarioSetId,
    startDateMs,
    runs: allRuns,
    enabled: pages.length <= 1,
    sseConnected,
  });

  const allScenarioSetIds = useMemo(() => {
    const merged: Record<string, string> = {};
    for (const page of pages) Object.assign(merged, page.scenarioSetIds);
    return merged;
  }, [pages]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    allRuns,
    allScenarioSetIds,
    hasMore: hasNextPage ?? false,
    loadMore,
    isLoading: isLoading && pages.length === 0,
    error,
    refetch,
  };
}
