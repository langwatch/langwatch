/**
 * Cursor-based pagination for suite run history.
 *
 * Manages cursor, accumulated pages, period resets, and data fetching.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { STALL_THRESHOLD_MS } from "~/server/scenarios/stall-detection";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type PageData = {
  runs: ScenarioRunData[];
  scenarioSetIds: Record<string, string>;
  hasMore: boolean;
  nextCursor?: string;
};

interface UseRunHistoryPaginationOptions {
  scenarioSetId?: string;
  startDateMs: number;
}

export function useRunHistoryPagination({
  scenarioSetId,
  startDateMs,
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
      refetchInterval: pages.length <= 1 ? 30_000 : undefined,
    },
  );

  // Accumulate pages as data arrives
  useEffect(() => {
    if (!runDataResult || !runDataResult.changed) return;

    if (cursor === undefined) {
      setPages([runDataResult]);
    } else if (cursor !== prevCursorRef.current) {
      setPages((prev) => [...prev, runDataResult]);
    }
    prevCursorRef.current = cursor;
  }, [runDataResult, cursor]);

  // Client-side stall detection safety net: the server computes stall status
  // at query time, but if the ClickHouse UpdatedAt was inflated by a
  // re-projection, the server may return IN_PROGRESS for runs that are
  // actually stalled. Re-check using the run's timestamp (= UpdatedAt).
  const allRuns = useMemo(() => {
    const now = Date.now();
    return pages.flatMap((p) => p.runs).map((run) => {
      if (
        run.status === ScenarioRunStatus.IN_PROGRESS &&
        now - run.timestamp >= STALL_THRESHOLD_MS
      ) {
        return { ...run, status: ScenarioRunStatus.STALLED };
      }
      return run;
    });
  }, [pages]);

  const allScenarioSetIds = useMemo(() => {
    const merged: Record<string, string> = {};
    for (const page of pages) {
      Object.assign(merged, page.scenarioSetIds);
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
    hasMore,
    loadMore,
    isLoading: isLoading && pages.length === 0,
    error,
    refetch,
  };
}
