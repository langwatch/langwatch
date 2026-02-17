import { useEffect, useMemo, useState } from "react";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
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

  // Fetch scenario run data with cursor-based pagination
  const {
    data: runData,
    error,
    isLoading,
  } = api.scenarios.getScenarioSetRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: scenarioSetId ?? "",
      limit,
      cursor,
    },
    {
      // Only fetch when we have both required IDs to avoid unnecessary API calls
      enabled: !!project?.id && !!scenarioSetId,
      refetchInterval: 1000,
    },
  );

  // Fetch total count for pagination info
  const { data: countData } =
    api.scenarios.getScenarioSetBatchRunCount.useQuery(
      {
        projectId: project?.id ?? "",
        scenarioSetId: scenarioSetId ?? "",
      },
      {
        enabled: !!project?.id && !!scenarioSetId,
      },
    );

  const totalCount = countData?.count ?? 0;
  const currentPage = cursorHistory.length + 1;
  const totalPages = Math.ceil(totalCount / limit);

  // Clamp cursor to valid range when total count changes
  useEffect(() => {
    if (totalCount === 0 && cursor) {
      setCursor(undefined);
      setCursorHistory([]);
    }
  }, [totalCount, cursor]);

  useEffect(() => {
    if (scenarioSetId && !batchRunId && runData?.runs?.length) {
      const lastRun = runData.runs[runData.runs.length - 1];
      if (lastRun) {
        goToSimulationBatchRuns(scenarioSetId, lastRun.batchRunId, {
          replace: true,
        });
      }
    }
  }, [scenarioSetId, batchRunId, runData?.runs, goToSimulationBatchRuns]);

  // Memoize the expensive data transformation to prevent unnecessary re-renders
  // This transforms raw API data into the UI-friendly Run format
  const runs = useMemo(() => {
    if (!runData?.runs?.length) return [];
    return transformRunDataToBatchRuns(
      runData.runs,
      currentPage,
      limit,
      totalCount,
    );
  }, [runData?.runs, currentPage, limit, totalCount]);

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
    if (runData?.nextCursor) {
      setCursorHistory((prev) => [...prev, cursor]);
      setCursor(runData.nextCursor);
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
      hasNextPage: Boolean(runData?.nextCursor),
      hasPrevPage: cursorHistory.length > 0,
      onPageChange: handlePageChange,
      onNextPage: handleNextPage,
      onPrevPage: handlePrevPage,
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
