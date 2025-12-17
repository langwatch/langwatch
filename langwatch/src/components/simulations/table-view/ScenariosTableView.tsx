import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/router";
import { Box, Text, VStack } from "@chakra-ui/react";
import {
  DataGrid,
  createDataGridStore,
  type FilterState,
  type SortingState,
} from "~/components/ui/datagrid";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { createScenarioColumns, generateDynamicColumns } from "./scenarioColumns";
import { ScenarioExpandedContent } from "./ScenarioExpandedContent";
import { StatusCell, VerdictCell, DurationCell, TimestampCell } from "./cells";
import type { ScenarioRunRow } from "./types";
import { ScenarioRunStatus, Verdict } from "~/app/api/scenario-events/[[...route]]/enums";

/**
 * Table view for scenarios/simulations data
 * Uses the generic DataGrid component with scenario-specific configuration
 */
export function ScenariosTableView() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const projectSlug = project?.slug ?? "";

  // Parse URL parameters for initial state - only on first render
  const initialUrlState = useRef<{
    filters: FilterState[];
    sorting: SortingState | undefined;
    page: number;
    pageSize: number;
    search: string;
  } | null>(null);

  if (initialUrlState.current === null) {
    const filtersParam = router.query.filters as string | undefined;
    let filters: FilterState[] = [];
    try {
      filters = filtersParam ? JSON.parse(filtersParam) : [];
    } catch {
      filters = [];
    }

    const sortBy = router.query.sortBy as string | undefined;
    const sortOrder = router.query.sortOrder as "asc" | "desc" | undefined;
    const sorting = sortBy && sortOrder
      ? { columnId: sortBy, order: sortOrder }
      : { columnId: "timestamp", order: "desc" as const };

    const pageParam = router.query.page as string | undefined;
    const page = pageParam ? parseInt(pageParam, 10) : 1;

    const pageSizeParam = router.query.pageSize as string | undefined;
    const pageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : 20;

    const search = (router.query.search as string) ?? "";

    initialUrlState.current = { filters, sorting, page, pageSize, search };
  }

  // Create columns with cell renderers - memoized to avoid recreating on every render
  const baseColumns = useMemo(() => {
    const cols = createScenarioColumns(projectSlug);

    // Add cell renderers to specific columns
    return cols.map((col) => {
      switch (col.id) {
        case "status":
          return { ...col, cell: StatusCell };
        case "verdict":
          return { ...col, cell: VerdictCell };
        case "durationInMs":
          return { ...col, cell: DurationCell };
        case "timestamp":
          return { ...col, cell: TimestampCell };
        default:
          return col;
      }
    });
  }, [projectSlug]);

  // Create the store once using useRef - this is the proper Zustand pattern
  // The store is created once and persists for the lifetime of the component
  const storeRef = useRef<ReturnType<typeof createDataGridStore<ScenarioRunRow>> | null>(null);

  if (storeRef.current === null) {
    storeRef.current = createDataGridStore<ScenarioRunRow>({
      columns: baseColumns,
      defaultPageSize: initialUrlState.current.pageSize,
      defaultSorting: initialUrlState.current.sorting,
      defaultFilters: initialUrlState.current.filters,
      defaultGlobalSearch: initialUrlState.current.search,
      defaultPage: initialUrlState.current.page,
      getRowId: (row) => row.scenarioRunId,
      storageKey: project?.id ? `scenarios-table-${project.id}` : undefined,
    });
  }

  // Use the store - this is the Zustand hook pattern
  const useStore = storeRef.current;

  // Subscribe to specific state slices to avoid re-renders on every state change
  const filters = useStore((state) => state.filters);
  const sorting = useStore((state) => state.sorting);
  const page = useStore((state) => state.page);
  const pageSize = useStore((state) => state.pageSize);
  const globalSearch = useStore((state) => state.globalSearch);
  const visibleColumns = useStore((state) => state.visibleColumns);

  // Get the full state for passing to DataGrid (but don't use it in effects)
  const storeState = useStore();

  // Fetch filtered scenario runs
  const {
    data: scenarioData,
    isLoading,
    error,
    refetch,
  } = api.scenarios.getFilteredScenarioRuns.useQuery(
    {
      projectId: project?.id ?? "",
      filters: filters.map((f) => ({
        columnId: f.columnId,
        operator: f.operator,
        value: f.value,
      })),
      sorting: sorting ?? undefined,
      pagination: {
        page,
        pageSize,
      },
      search: globalSearch || undefined,
      includeTraces: true,
    },
    {
      enabled: !!project?.id,
      refetchInterval: 30000, // Refetch every 30 seconds
    }
  );

  // Update store when data changes - use getState() for imperative updates
  useEffect(() => {
    const store = storeRef.current;
    if (!store) return;

    if (scenarioData) {
      // Transform ScenarioRunData to ScenarioRunRow format
      const rows: ScenarioRunRow[] = scenarioData.rows.map((run) => {
        // Extract trace info from messages
        const traceMap = new Map<string, { input: string; output: string; timestamp: number }>();

        for (const message of run.messages ?? []) {
          const traceId = (message as { trace_id?: string }).trace_id;
          if (traceId) {
            const existing = traceMap.get(traceId) ?? { input: "", output: "", timestamp: 0 };
            const content = typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content ?? "");

            // Determine if this is input or output based on role
            const role = (message as { role?: string }).role;
            if (role === "user" || role === "human") {
              existing.input = content;
            } else if (role === "assistant" || role === "ai") {
              existing.output = content;
            }
            existing.timestamp = (message as { timestamp?: number }).timestamp ?? run.timestamp;
            traceMap.set(traceId, existing);
          }
        }

        // Convert trace map to TraceRow array
        const traces = Array.from(traceMap.entries()).map(([traceId, data]) => ({
          traceId,
          timestamp: data.timestamp,
          input: data.input,
          output: data.output,
          metadata: {},
          spanCount: 0,
          totalTokens: 0,
          totalCost: 0,
        }));

        return {
          scenarioRunId: run.scenarioRunId,
          scenarioId: run.scenarioId,
          scenarioSetId: run.scenarioSetId ?? "",
          batchRunId: run.batchRunId,
          name: run.name ?? null,
          description: run.description ?? null,
          status: run.status,
          verdict: run.results?.verdict ?? null,
          timestamp: run.timestamp,
          durationInMs: run.durationInMs,
          metCriteria: run.results?.metCriteria ?? [],
          unmetCriteria: run.results?.unmetCriteria ?? [],
          traces,
        };
      });

      store.getState().setRows(rows);
      store.getState().setTotalCount(scenarioData.totalCount);

      // Add dynamic columns from metadata keys
      if (scenarioData.metadataKeys.length > 0) {
        const dynamicCols = generateDynamicColumns(scenarioData.metadataKeys);
        const allColumns = [...baseColumns, ...dynamicCols];
        store.getState().setColumns(allColumns);
      }
    }
    store.getState().setIsLoading(isLoading);
    store.getState().setError(error?.message ?? null);
  }, [scenarioData, isLoading, error, baseColumns]);

  // Sync state changes to URL
  const handleStateChange = useCallback(
    (state: {
      filters: FilterState[];
      sorting: SortingState | null;
      page: number;
      pageSize: number;
      globalSearch: string;
    }) => {
      const query: Record<string, string> = {
        ...router.query,
        view: "table",
      };

      if (state.filters.length > 0) {
        query.filters = JSON.stringify(state.filters);
      } else {
        delete query.filters;
      }

      if (state.sorting) {
        query.sortBy = state.sorting.columnId;
        query.sortOrder = state.sorting.order;
      } else {
        delete query.sortBy;
        delete query.sortOrder;
      }

      if (state.page > 1) {
        query.page = String(state.page);
      } else {
        delete query.page;
      }

      if (state.pageSize !== 20) {
        query.pageSize = String(state.pageSize);
      } else {
        delete query.pageSize;
      }

      if (state.globalSearch) {
        query.search = state.globalSearch;
      } else {
        delete query.search;
      }

      void router.replace({ query }, undefined, { shallow: true });
    },
    [router]
  );

  // Export handler
  const handleExport = useCallback(async () => {
    if (!project?.id) return;

    // Get visible columns from selector
    const visibleColumnIds = Array.from(visibleColumns);

    // Call export API
    const response = await fetch("/api/scenarios/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        filters,
        columns: visibleColumnIds,
        includeTraces: false,
      }),
    });

    if (!response.ok) {
      throw new Error("Export failed");
    }

    // Download the CSV
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scenarios-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, [project?.id, filters, visibleColumns]);

  // Get enum options for filter dropdowns
  const getEnumOptions = useCallback((columnId: string): string[] => {
    switch (columnId) {
      case "status":
        return Object.values(ScenarioRunStatus);
      case "verdict":
        return Object.values(Verdict);
      default:
        return [];
    }
  }, []);

  // Render expanded content
  const renderExpandedContent = useCallback(
    (row: ScenarioRunRow) => <ScenarioExpandedContent row={row} />,
    []
  );

  if (!project) {
    return (
      <VStack gap={4} align="center" py={8}>
        <Text color="gray.500">Loading project...</Text>
      </VStack>
    );
  }

  return (
    <Box h="full">
      <DataGrid
        store={storeState}
        getRowId={(row) => row.scenarioRunId}
        renderExpandedContent={renderExpandedContent}
        getEnumOptions={getEnumOptions}
        onStateChange={handleStateChange}
        onExport={handleExport}
        onRefresh={() => void refetch()}
        emptyMessage="No scenario runs found. Try adjusting your filters."
        errorMessage={error?.message}
      />
    </Box>
  );
}
