/**
 * Cursor-based pagination for suite run history.
 *
 * Manages cursor, accumulated pages, period resets, and data fetching.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useSuiteRunFreshness } from "./useSuiteRunFreshness";

type PageData = {
  runs: ScenarioRunData[];
  scenarioSetIds: Record<string, string>;
  /** Per batch, how many runs it set out to queue. Absent for older batches. */
  expectedCounts?: Record<string, number>;
  hasMore: boolean;
  nextCursor?: string;
};

interface UseRunHistoryPaginationOptions {
  scenarioSetId?: string;
  startDateMs: number;
  /** While the SSE stream is connected, fallback freshness polling stops. */
  sseConnected?: boolean;
}

export function useRunHistoryPagination({
  scenarioSetId,
  startDateMs,
  sseConnected = false,
}: UseRunHistoryPaginationOptions) {
  const { project } = useOrganizationTeamProject();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [pages, setPages] = useState<PageData[]>([]);
  const prevCursorRef = useRef<string | undefined>(undefined);

  // Reset pagination when period changes
  useEffect(() => {
    setCursor(undefined);
    setPages([]);
  }, [startDateMs]);

  const {
    data: runDataResult,
    isLoading,
    error,
    refetch,
  } = api.scenarios.getSuiteRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId,
      limit: 20,
      cursor,
      startDate: startDateMs,
    },
    {
      enabled: !!project,
      // No timer on the heavy query: SSE invalidations and the freshness
      // probe below drive refetches, so quiet sets never re-download runs.
      trpc: { context: { skipBatch: true } },
    },
  );

  // Accumulate pages as data arrives
  useEffect(() => {
    if (!runDataResult?.changed) return;

    if (cursor === undefined) {
      setPages([runDataResult]);
    } else if (cursor !== prevCursorRef.current) {
      setPages((prev) => [...prev, runDataResult]);
    }
    prevCursorRef.current = cursor;
  }, [runDataResult, cursor]);

  // A run's status is whatever was written for it. There is no client-side
  // stall re-check any more: STALLED is stored by the `scenarioExecution`
  // process when a run's deadline fires (ADR-073 step 2), so re-deriving it
  // here from `timestamp` would only ever disagree with the server — which is
  // exactly what the old safety net did whenever a re-projection moved
  // ClickHouse's UpdatedAt.
  const allRuns = useMemo(
    () => pages.flatMap((p) => p.runs),
    [pages],
  );

  // Cheap freshness probe replaces the old 30s heavy re-fetch. Matches the
  // previous auto-refresh scope: only while the user hasn't paginated deeper
  // (accumulated pages beyond the first are not auto-refreshed).
  useSuiteRunFreshness({
    scenarioSetId,
    startDateMs,
    runs: allRuns,
    enabled: pages.length <= 1,
    sseConnected,
  });

  const allScenarioSetIds = useMemo(() => {
    const merged: Record<string, string> = {};
    for (const page of pages) {
      Object.assign(merged, page.scenarioSetIds);
    }
    return merged;
  }, [pages]);

  const allExpectedCounts = useMemo(() => {
    const merged: Record<string, number> = {};
    for (const page of pages) {
      Object.assign(merged, page.expectedCounts);
    }
    return merged;
  }, [pages]);

  const hasMore =
    pages.length > 0 ? (pages[pages.length - 1]?.hasMore ?? false) : false;

  const loadMore = useCallback(() => {
    const lastPage = pages[pages.length - 1];
    if (lastPage?.nextCursor) {
      setCursor(lastPage.nextCursor);
    }
  }, [pages]);

  return {
    allRuns,
    allScenarioSetIds,
    allExpectedCounts,
    hasMore,
    loadMore,
    isLoading: isLoading && pages.length === 0,
    error,
    refetch,
  };
}
