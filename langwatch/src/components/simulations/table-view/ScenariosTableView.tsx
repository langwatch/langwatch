import { useCallback, useEffect, useMemo, useRef } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import { DataGrid, createDataGridStore } from "~/components/ui/datagrid";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  createScenarioColumns,
  generateDynamicColumns,
} from "./scenarioColumns";
import { ScenarioExpandedContent } from "./ScenarioExpandedContent";
import {
  StatusCell,
  VerdictCell,
  DurationCell,
  TimestampCell,
  ActionsCell,
} from "./cells";
import type { ScenarioRunRow } from "./types";
import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";
import { ScenarioRunStatus, Verdict } from "~/app/api/scenario-events/[[...route]]/enums";

/**
 * Table view for scenarios/simulations data
 * Uses the generic DataGrid component with scenario-specific configuration
 *
 * URL sync is handled automatically by the store via urlSync: true
 * - Filters, sorting, pagination sync to URL query params
 * - URL state takes priority over localStorage on mount
 */
export function ScenariosTableView() {
  const { project } = useOrganizationTeamProject();
  const projectSlug = project?.slug ?? "";

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
        case "actions":
          return { ...col, cell: ActionsCell };
        default:
          return col;
      }
    });
  }, [projectSlug]);

  // Create the store once using useRef - this is the proper Zustand pattern
  // The store is created once and persists for the lifetime of the component
  // urlSync: true enables automatic URL param sync (handled by store internally)
  const storeRef = useRef<ReturnType<
    typeof createDataGridStore<ScenarioRunRow>
  > | null>(null);

  if (storeRef.current === null) {
    storeRef.current = createDataGridStore<ScenarioRunRow>({
      columns: baseColumns,
      defaultSorting: { columnId: "timestamp", order: "desc" },
      getRowId: (row) => row.scenarioRunId,
      storageKey: project?.id ? `scenarios-table-${project.id}` : undefined,
      urlSync: true, // Enable automatic URL sync
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
  const groupBy = useStore((state) => state.groupBy);

  // Get the full state for passing to DataGrid (but don't use it in effects)
  const storeState = useStore();

  // Fetch filtered scenario runs (ungrouped)
  const {
    data: scenarioData,
    isLoading: isLoadingUngrouped,
    isFetching: isFetchingUngrouped,
    error: errorUngrouped,
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
      enabled: !!project?.id && !groupBy,
      refetchInterval: 30000,
    }
  );

  // Fetch grouped scenario runs
  const {
    data: groupedData,
    isLoading: isLoadingGrouped,
    isFetching: isFetchingGrouped,
    error: errorGrouped,
  } = api.scenarios.getGroupedScenarioRuns.useQuery(
    {
      projectId: project?.id ?? "",
      groupBy: groupBy ?? "",
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
    },
    {
      enabled: !!project?.id && !!groupBy,
      refetchInterval: 30000,
    }
  );

  const isLoading = groupBy ? isLoadingGrouped : isLoadingUngrouped;
  const isFetching = groupBy ? isFetchingGrouped : isFetchingUngrouped;
  const error = groupBy ? errorGrouped : errorUngrouped;

  // Helper to transform ScenarioRunData to ScenarioRunRow
  const transformRunData = useCallback(
    (run: ScenarioRunData): ScenarioRunRow => {
      const traceMap = new Map<
        string,
        { input: string; output: string; timestamp: number }
      >();

      for (const message of run.messages ?? []) {
        const traceId = (message as { trace_id?: string }).trace_id;
        if (traceId) {
          const existing = traceMap.get(traceId) ?? {
            input: "",
            output: "",
            timestamp: 0,
          };
          const content =
            typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content ?? "");

          const role = (message as { role?: string }).role;
          if (role === "user" || role === "human") {
            existing.input = content;
          } else if (role === "assistant" || role === "ai") {
            existing.output = content;
          }
          existing.timestamp =
            (message as { timestamp?: number }).timestamp ?? run.timestamp;
          traceMap.set(traceId, existing);
        }
      }

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
    },
    []
  );

  // Update store when ungrouped data changes
  useEffect(() => {
    const store = storeRef.current;
    if (!store || groupBy) return; // Skip if grouping

    if (scenarioData) {
      const rows = scenarioData.rows.map(transformRunData);
      store.getState().setRows(rows);
      store.getState().setTotalCount(scenarioData.totalCount);

      if (scenarioData.metadataKeys.length > 0) {
        const dynamicCols = generateDynamicColumns(scenarioData.metadataKeys);
        const allColumns = [...baseColumns, ...dynamicCols];
        store.getState().setColumns(allColumns);
      }
    }
    store.getState().setIsLoading(isLoadingUngrouped);
    store.getState().setError(errorUngrouped?.message ?? null);
  }, [
    scenarioData,
    isLoadingUngrouped,
    errorUngrouped,
    baseColumns,
    groupBy,
    transformRunData,
  ]);

  // Update store when grouped data changes
  useEffect(() => {
    const store = storeRef.current;
    if (!store || !groupBy) return; // Skip if not grouping

    if (groupedData) {
      // Flatten grouped data into rows for display
      // The DataGridTable handles the visual grouping
      const allRows: ScenarioRunRow[] = [];
      for (const group of groupedData.groups) {
        for (const run of group.rows) {
          allRows.push(transformRunData(run));
        }
      }
      store.getState().setRows(allRows);
      // For grouped view, pagination is based on number of groups
      store.getState().setTotalCount(groupedData.totalGroups);
    }
    store.getState().setIsLoading(isLoadingGrouped);
    store.getState().setError(errorGrouped?.message ?? null);
  }, [groupedData, isLoadingGrouped, errorGrouped, groupBy, transformRunData]);

  // Export mutation
  const exportMutation = api.scenarios.exportScenariosCsv.useMutation();

  // Export handler - exports ALL filtered data with visible columns
  const handleExport = useCallback(async () => {
    if (!project?.id) return;

    // Get visible columns (excluding actions column and internal columns)
    const visibleColumnIds = Array.from(visibleColumns).filter(
      (col) => col !== "actions" && !col.startsWith("__")
    );

    try {
      // Call tRPC export mutation with current filters, sorting, and visible columns
      const result = await exportMutation.mutateAsync({
        projectId: project.id,
        filters: filters.map((f) => ({
          columnId: f.columnId,
          operator: f.operator,
          value: f.value,
        })),
        columns: visibleColumnIds,
        includeTraces: false,
      });

      // Download the CSV
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Export failed:", error);
    }
  }, [project?.id, filters, visibleColumns, exportMutation]);

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
        onExport={handleExport}
        isFetching={isFetching}
        emptyMessage="No scenario runs found. Try adjusting your filters."
        errorMessage={error?.message}
      />
    </Box>
  );
}
