import { useEffect, useMemo, useState } from "react";
import type { BatchHistoryItem } from "~/server/scenarios/scenario-event.types";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";
import type { Run, RunItem } from "./types";

const logger = createLogger("useSetRunHistorySidebarController");

/**
 * Custom hook that manages the state and behavior for the Set Run History Sidebar.
 *
 * This hook handles:
 * - Fetching scenario run data from the API with pagination
 * - Transforming raw run data into grouped batch runs for display
 * - Providing navigation handlers for run selection
 * - Managing loading and error states
 * - Pagination state management
 *
 * @returns Object containing runs data, click handlers, pagination controls, and state flags
 */
export const useSetRunHistorySidebarController = () => {
  const { goToSimulationBatchRuns, scenarioSetId, batchRunId } =
    useSimulationRouter();
  const { project } = useOrganizationTeamProject();

  // Cursor-based pagination state
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>(
    [],
  );
  const limit = 8; // Fixed limit for now

  // Reset cursor when navigating to a different scenario set
  useEffect(() => {
    setCursor(undefined);
    setCursorHistory([]);
  }, [scenarioSetId]);

  // Fetch pre-aggregated batch history (no full messages in payload)
  // totalCount is returned atomically with the batch list to avoid race conditions
  const {
    data: batchHistoryData,
    error,
    isLoading,
  } = api.scenarios.getScenarioSetBatchHistory.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: scenarioSetId ?? "",
      limit,
      cursor,
    },
    {
      enabled: !!project?.id && !!scenarioSetId,
      refetchInterval: 1000,
    },
  );

  const totalCount = batchHistoryData?.totalCount ?? 0;
  const currentPage = cursorHistory.length + 1;
  const totalPages = Math.ceil(totalCount / limit);

  // Clamp cursor when total count changes
  useEffect(() => {
    if (totalCount === 0 && cursor) {
      setCursor(undefined);
      setCursorHistory([]);
    }
  }, [totalCount, cursor]);

  useEffect(() => {
    if (scenarioSetId && !batchRunId && batchHistoryData?.batches?.length) {
      const lastBatch = batchHistoryData.batches[batchHistoryData.batches.length - 1];
      if (lastBatch) {
        goToSimulationBatchRuns(scenarioSetId, lastBatch.batchRunId, {
          replace: true,
        });
      }
    }
  }, [scenarioSetId, batchRunId, batchHistoryData?.batches, goToSimulationBatchRuns]);

  // Server already groups and sorts — map BatchHistoryItem[] directly to Run[]
  const runs = useMemo(() => {
    if (!batchHistoryData?.batches?.length) return [];
    return batchHistoryItemsToRuns(
      batchHistoryData.batches,
      currentPage,
      limit,
      totalCount,
    );
  }, [batchHistoryData?.batches, currentPage, limit, totalCount]);

  // Extract click handler for better testability and performance
  // Memoized to prevent child component re-renders when dependencies haven't changed
  const handleRunClick = useMemo(
    () => (batchRunId: string) => {
      if (!scenarioSetId) {
        logger.warn("Cannot navigate: scenarioSetId is not defined");
        return;
      }
      goToSimulationBatchRuns(scenarioSetId, batchRunId);
    },
    [scenarioSetId, goToSimulationBatchRuns],
  );

  // Cursor-based pagination handlers
  const handleNextPage = () => {
    if (batchHistoryData?.nextCursor) {
      setCursorHistory((prev) => [...prev, cursor]);
      setCursor(batchHistoryData.nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorHistory.length > 0) {
      const newHistory = [...cursorHistory];
      const prevCursor = newHistory.pop();
      setCursorHistory(newHistory);
      setCursor(prevCursor);
    }
  };

  const handlePageChange = (newPage: number) => {
    // For cursor-based pagination, we can't jump to arbitrary pages
    // Reset to beginning and navigate forward
    if (newPage === 1) {
      setCursor(undefined);
      setCursorHistory([]);
    } else if (newPage > currentPage) {
      // Navigate forward from current position
      // const stepsForward = newPage - currentPage;
      // This is simplified - in practice you'd need to fetch each page
      // For now, just allow forward navigation
    }
  };

  return {
    runs,
    onRunClick: handleRunClick,
    scenarioSetId,
    isLoading,
    error, // Expose error state for better UX handling in components

    // Pagination state and controls
    pagination: {
      page: currentPage,
      limit,
      totalCount,
      totalPages,
      hasNextPage: Boolean(batchHistoryData?.nextCursor),
      hasPrevPage: cursorHistory.length > 0,
      onPageChange: handlePageChange,
      onNextPage: handleNextPage,
      onPrevPage: handlePrevPage,
    },
  };
};

/**
 * Maps server-aggregated BatchHistoryItem[] to Run[] for the sidebar.
 * No client-side grouping needed — server already grouped and sorted.
 */
const batchHistoryItemsToRuns = (
  batches: BatchHistoryItem[],
  currentPage: number,
  limit: number,
  totalCount: number,
): Run[] => {
  return batches.map((batch, idx) => ({
    batchRunId: batch.batchRunId,
    scenarioRunId: batch.items[0]?.scenarioRunId ?? batch.batchRunId,
    label: `Run #${totalCount - ((currentPage - 1) * limit + idx)}`,
    timestamp: batch.lastRunAt,
    firstCompletedAt: batch.firstCompletedAt,
    allCompletedAt: batch.allCompletedAt,
    isRunning: batch.runningCount > 0,
    items: batch.items.map(
      (i): RunItem => ({
        title: i.name ?? "",
        description: i.description ?? "",
        status: i.status,
        batchRunId: batch.batchRunId,
        scenarioRunId: i.scenarioRunId,
      }),
    ),
  }));
};
