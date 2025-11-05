import { useEffect, useMemo, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";

/**
 * Centralized Simulation Query Hooks
 *
 * Single source of truth for all simulation-related data fetching.
 * Provides consistent patterns for caching, polling, and error handling.
 */

/**
 * Get scenario run IDs for a specific batch run (OPTIMIZED - lightweight).
 *
 * Use this for rendering grids/lists where individual cards will fetch their own details.
 * Returns only IDs (~95% smaller payload than full data).
 * Pre-sorted by timestamp from Elasticsearch.
 *
 * Polling: 1 second interval
 * Use case: Main grid rendering
 *
 * @param scenarioSetId - The scenario set ID
 * @param batchRunId - The batch run ID
 * @param enabled - Whether to enable the query (default: true)
 */
export function useScenarioRunIds({
  scenarioSetId,
  batchRunId,
  enabled = true,
}: {
  scenarioSetId?: string;
  batchRunId?: string;
  enabled?: boolean;
}) {
  const { project } = useOrganizationTeamProject();

  return api.scenarios.getScenarioRunIdsForBatchRun.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: scenarioSetId ?? "",
      batchRunId: batchRunId ?? "",
    },
    {
      enabled: !!project?.id && !!scenarioSetId && !!batchRunId && enabled,
      refetchInterval: 1000,
    },
  );
}

/**
 * Get paginated batch runs for a scenario set with full pagination logic encapsulated.
 *
 * Use this for the sidebar or any paginated list of batch runs.
 * Manages cursor state, history, and provides next/prev navigation.
 *
 * Polling: 1 second interval
 * Use case: Sidebar batch run history
 *
 * @param scenarioSetId - The scenario set ID
 * @param limit - Number of items per page (default: 8)
 * @param enabled - Whether to enable the query (default: false, manually controlled)
 */
export function usePaginatedBatchRuns({
  scenarioSetId,
  limit = 8,
  enabled = false,
}: {
  scenarioSetId?: string;
  limit?: number;
  enabled?: boolean;
}) {
  const { project } = useOrganizationTeamProject();

  // Cursor-based pagination state
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>(
    [],
  );

  // Reset cursor when navigating to a different scenario set
  useEffect(() => {
    setCursor(undefined);
    setCursorHistory([]);
  }, [scenarioSetId]);

  // Fetch paginated batch run data
  const {
    data: runData,
    error,
    isLoading,
    refetch,
  } = api.scenarios.getScenarioSetRunData.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: scenarioSetId ?? "",
      limit,
      cursor,
    },
    {
      enabled: !!project?.id && !!scenarioSetId && enabled,
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
  const hasMore = runData?.hasMore ?? false;
  const currentPage = cursorHistory.length + 1;
  const totalPages = Math.ceil(totalCount / limit);

  // Clamp cursor to valid range when total count changes
  useEffect(() => {
    if (totalCount === 0 && cursor) {
      setCursor(undefined);
      setCursorHistory([]);
    }
  }, [totalCount, cursor]);

  /**
   * Navigate to the next page of results
   */
  const nextPage = () => {
    if (runData?.nextCursor) {
      setCursorHistory([...cursorHistory, cursor]);
      setCursor(runData.nextCursor);
    }
  };

  /**
   * Navigate to the previous page of results
   */
  const prevPage = () => {
    if (cursorHistory.length > 0) {
      const newHistory = [...cursorHistory];
      const previousCursor = newHistory.pop();
      setCursorHistory(newHistory);
      setCursor(previousCursor);
    }
  };

  /**
   * Reset pagination to the first page
   */
  const resetPagination = () => {
    setCursor(undefined);
    setCursorHistory([]);
  };

  return {
    // Data
    runs: runData?.runs ?? [],

    // Pagination state
    currentPage,
    totalPages,
    totalCount,
    hasMore,
    hasPrevious: cursorHistory.length > 0,

    // Pagination controls
    nextPage,
    prevPage,
    resetPagination,

    // Query state
    isLoading,
    error,
    refetch,
  };
}

/**
 * Get individual scenario run state with full details.
 *
 * Use this for displaying individual scenario run cards.
 * Fetches full run data including messages, status, results.
 * Automatically stops polling when run is complete.
 *
 * Polling: 1 second while running, stops when complete
 * Use case: Individual scenario run cards
 *
 * @param scenarioRunId - The scenario run ID
 * @param enabled - Whether to enable the query (default: true)
 */
export function useScenarioRunState({
  scenarioRunId,
  enabled = true,
}: {
  scenarioRunId?: string;
  enabled?: boolean;
}) {
  const { project } = useOrganizationTeamProject();

  return api.scenarios.getRunState.useQuery(
    {
      scenarioRunId: scenarioRunId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!scenarioRunId && enabled,
      refetchInterval: (data) => {
        const isRunning =
          data?.status === ScenarioRunStatus.IN_PROGRESS ||
          data?.status === ScenarioRunStatus.PENDING;
        return isRunning ? 1000 : false; // Stop polling when complete
      },
    },
  );
}

/**
 * Get all scenario sets for a project.
 *
 * Use this for the simulations overview/list page.
 * Returns high-level metadata about all scenario sets.
 *
 * Polling: Adaptive (4s when focused, 30s when blurred)
 * Use case: Simulations list page
 *
 * @param refetchInterval - Custom refetch interval in milliseconds
 */
export function useScenarioSets({
  refetchInterval = 4000,
}: {
  refetchInterval?: number;
} = {}) {
  const { project } = useOrganizationTeamProject();

  return api.scenarios.getScenarioSetsData.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
      refetchInterval,
    },
  );
}

/**
 * Get total count of batch runs for a scenario set.
 *
 * Use this for pagination calculations without fetching full data.
 *
 * Use case: Pagination UI, statistics
 *
 * @param scenarioSetId - The scenario set ID
 */
export function useBatchRunCount({
  scenarioSetId,
}: {
  scenarioSetId?: string;
}) {
  const { project } = useOrganizationTeamProject();

  const { data } = api.scenarios.getScenarioSetBatchRunCount.useQuery(
    {
      projectId: project?.id ?? "",
      scenarioSetId: scenarioSetId ?? "",
    },
    {
      enabled: !!project?.id && !!scenarioSetId,
    },
  );

  return {
    count: data?.count ?? 0,
  };
}
