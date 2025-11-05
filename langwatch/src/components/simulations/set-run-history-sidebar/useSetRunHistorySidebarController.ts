import { useMemo, useEffect } from "react";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { usePaginatedBatchRuns } from "~/hooks/simulations/useSimulationQueries";
import type { Run, RunItem } from "./types";
import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useSetRunHistorySidebarController");

/**
 * Custom hook that manages the state and behavior for the Set Run History Sidebar.
 *
 * This hook handles:
 * - Fetching scenario run data via centralized pagination hook
 * - Transforming raw run data into grouped batch runs for display
 * - Providing navigation handlers for run selection
 * - Managing loading and error states
 * - Auto-redirect to most recent batch run when no batchRunId in URL
 *
 * @returns Object containing runs data, click handlers, pagination controls, and state flags
 */
export const useSetRunHistorySidebarController = () => {
  const { goToSimulationBatchRuns, scenarioSetId, batchRunId } =
    useSimulationRouter();

  // Use centralized paginated query hook (encapsulates all pagination logic)
  const {
    runs: rawRuns,
    currentPage,
    totalPages,
    totalCount,
    hasMore,
    hasPrevious,
    nextPage,
    prevPage,
    isLoading,
    error,
  } = usePaginatedBatchRuns({
    scenarioSetId,
    limit: 8,
    enabled: !!scenarioSetId,
  });

  /**
   * Auto-redirect to most recent batch run when batchRunId is missing from URL.
   * This provides better UX by automatically showing the latest run.
   */
  useEffect(() => {
    if (scenarioSetId && !batchRunId && rawRuns?.length) {
      const lastRun = rawRuns[rawRuns.length - 1];

      if (lastRun) {
        goToSimulationBatchRuns(scenarioSetId, lastRun.batchRunId, {
          replace: true,
        });
      }
    }
  }, [scenarioSetId, batchRunId, rawRuns, goToSimulationBatchRuns]);

  // Memoize the expensive data transformation to prevent unnecessary re-renders
  // This transforms raw API data into the UI-friendly Run format
  const runs = useMemo(() => {
    if (!rawRuns?.length) return [];
    return transformRunDataToBatchRuns(rawRuns, currentPage, 8, totalCount);
  }, [rawRuns, currentPage, totalCount]);

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

  const handlePageChange = (newPage: number) => {
    // For cursor-based pagination, we can't jump to arbitrary pages easily
    // This is a simplified implementation - could be enhanced in the future
    logger.info("Page change requested to page", newPage);
  };

  return {
    runs,
    onRunClick: handleRunClick,
    scenarioSetId,
    isLoading,
    error, // Expose error state for better UX handling in components

    // Pagination state and controls (delegated to centralized hook)
    pagination: {
      page: currentPage,
      limit: 8,
      totalCount,
      totalPages,
      hasNextPage: hasMore,
      hasPrevPage: hasPrevious,
      onPageChange: handlePageChange,
      onNextPage: nextPage,
      onPrevPage: prevPage,
    },
  };
};

/**
 * Transforms raw scenario run data from the API into grouped batch runs for UI display.
 *
 * This function:
 * 1. Groups individual scenario runs by their batchRunId
 * 2. Sorts runs chronologically by timestamp
 * 3. Adds display-friendly labels and formatting
 * 4. Returns runs in reverse chronological order (newest first)
 *
 * @param runData - Array of raw scenario run data from the API
 * @returns Array of Run objects ready for UI consumption
 */
const transformRunDataToBatchRuns = (
  runData: ScenarioRunData[],
  currentPage: number,
  limit: number,
  totalCount: number,
): Run[] => {
  // Group runs by batchRunId using a functional reduce approach
  // Each batch run contains metadata and an array of individual scenario runs
  const batchRunsMap = runData.reduce(
    (acc, run) => {
      const batchRunId = run.batchRunId;

      // Initialize new batch run if we haven't seen this batchRunId before
      if (!acc[batchRunId]) {
        acc[batchRunId] = {
          scenarioRunId: run.scenarioRunId,
          batchRunId: run.batchRunId,
          timestamp: run.timestamp, // Store raw timestamp for accurate sorting
          duration: formatDuration(run.durationInMs),
          items: [],
        };
      }

      // Add this scenario run to the batch's items array
      acc[batchRunId]!.items.push(createRunItem(run));
      return acc;
    },
    {} as Record<string, Omit<Run, "label" | "date">>,
  );

  // Sort by timestamp (numerical) for accurate chronological ordering
  // Then add display labels and format dates for UI consumption
  return Object.values(batchRunsMap)
    .sort((a, b) => b.timestamp - a.timestamp) // Sort newest first (descending)
    .map((run, idx) => ({
      ...run,
      label: `Run #${totalCount - ((currentPage - 1) * limit + idx)}`, // Newest gets highest number
    }));
};

/**
 * Formats duration from milliseconds to a human-readable seconds string.
 * Rounds to nearest second for cleaner display.
 *
 * @param durationInMs - Duration in milliseconds
 * @returns Formatted duration string (e.g., "45s")
 */
const formatDuration = (durationInMs: number): string => {
  return `${Math.round(durationInMs / 1000)}s`;
};

/**
 * Creates a RunItem object from raw scenario run data.
 * Handles potential null/undefined values with safe defaults.
 *
 * @param run - Raw scenario run data from API
 * @returns RunItem object for UI consumption
 */
const createRunItem = (run: ScenarioRunData): RunItem => ({
  title: run.name ?? "", // Fallback to empty string if name is null/undefined
  description: run.description ?? "", // Fallback to empty string if description is null/undefined
  status: run.status,
  batchRunId: run.batchRunId,
  scenarioRunId: run.scenarioRunId,
});
