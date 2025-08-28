import { useMemo, useState } from "react";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import type { Run, RunItem } from "./types";
import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";
import { createLogger } from "~/utils/logger";

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
  const { goToSimulationBatchRuns, scenarioSetId } = useSimulationRouter();
  const { project } = useOrganizationTeamProject();

  // Pagination state
  const [page, setPage] = useState(1);
  const [limit] = useState(10); // Fixed limit for now
  const offset = (page - 1) * limit;

  // Fetch scenario run data with pagination
  const {
    data: runData,
    error,
    isLoading,
  } = api.scenarios.getScenarioSetRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: scenarioSetId ?? "",
      limit,
      offset,
    },
    {
      // Only fetch when we have both required IDs to avoid unnecessary API calls
      enabled: !!project?.id && !!scenarioSetId,
      refetchInterval: 1000,
    }
  );

  // Fetch total count for pagination
  const { data: countData } =
    api.scenarios.getScenarioSetBatchRunCount.useQuery(
      {
        projectId: project?.id ?? "",
        scenarioSetId: scenarioSetId ?? "",
      },
      {
        enabled: !!project?.id && !!scenarioSetId,
      }
    );

  const totalCount = countData?.count ?? 0;
  const totalPages = Math.ceil(totalCount / limit);

  // Memoize the expensive data transformation to prevent unnecessary re-renders
  // This transforms raw API data into the UI-friendly Run format
  const runs = useMemo(() => {
    if (!runData?.length) return [];
    return transformRunDataToBatchRuns(runData);
  }, [runData]);

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
    [scenarioSetId, goToSimulationBatchRuns]
  );

  // Pagination handlers
  const handlePageChange = (newPage: number) => {
    setPage(Math.max(1, Math.min(newPage, totalPages)));
  };

  const handleNextPage = () => {
    if (page < totalPages) {
      setPage(page + 1);
    }
  };

  const handlePrevPage = () => {
    if (page > 1) {
      setPage(page - 1);
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
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
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
const transformRunDataToBatchRuns = (runData: ScenarioRunData[]): Run[] => {
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
    {} as Record<string, Omit<Run, "label" | "date">>
  );

  // Sort by timestamp (numerical) for accurate chronological ordering
  // Then add display labels and format dates for UI consumption
  return Object.values(batchRunsMap)
    .sort((a, b) => a.timestamp - b.timestamp) // Chronological sort by actual timestamp
    .map((run, idx) => ({
      ...run,
      label: `Run #${idx + 1}`, // Sequential labeling based on chronological order
    }))
    .reverse(); // Newest runs first for better UX
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
