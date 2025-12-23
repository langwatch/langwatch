import { useCallback, useMemo } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import { DataGrid } from "~/components/ui/datagrid";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { createScenarioColumns } from "./scenarioColumns";
import { ScenarioExpandedContent } from "./ScenarioExpandedContent";
import type { ScenarioRunRow } from "./types";
import { dataGridStore,
useDataGridStore } from "~/components/ui/datagrid/useDataGridStore.v2";
import { useExportScenarioRuns } from "~/features/simulations/hooks/useExportScenarioRuns";
import {
  getCoreRowModel,
  type Row,
  useReactTable,
  getSortedRowModel,
  getGroupedRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
} from "@tanstack/react-table";

const columns = createScenarioColumns();

const store = dataGridStore;

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
  // const { downloadCsv } = useExportScenarioRuns();

  // // Subscribe to specific state slices to avoid re-renders on every state change
  // const filters = store((state) => state.columnFilters);
  // const grouping = store((state) => state.grouping);
  // const sorting = store((state) => state.sorting);
  // const pagination = store((state) => state.pagination);
  // const columnVisibility = store((state) => state.columnVisibility);
  // const globalFilter = store((state) => state.globalFilter);
  // const toggleColumnVisibility = store((state) => state.toggleColumnVisibility);
  // const handlers = store(state => {
  //   return {
  //     onSortingChange: state.setSorting,
  //     onGroupingChange: state.setGrouping,
  //     onPaginationChange: state.setPagination,
  //     onGlobalFilterChange: state.setGlobalFilter,
  //     onColumnVisibilityChange: state.setColumnVisibility,
  //   };
  // });

  // const scenarioRuns = [] as ScenarioRunRow[];
  const isLoading = false;
  const isFetching = false;
  // // Fetch filtered scenario runs (ungrouped)
  const {
    data,
    isLoading: isLoadingScenarioRuns,
    isFetching: isFetchingScenarioRuns,
    // error: errorScenarioRuns,
  } = api.scenarios.getAllScenarioRunsWithTraces.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project,
      refetchInterval: 30000,
    }
  );

  const scenarioRuns = useMemo(() => data ?? [], [data]);

  // const isLoading = isLoadingScenarioRuns;
  // const isFetching = isFetchingScenarioRuns;
  // const error = errorScenarioRuns;

  // Render expanded content
  const renderExpandedContent = useCallback(
    (row: Row<ScenarioRunRow>) => <ScenarioExpandedContent row={row} />,
    []
  );

  console.log('scenarioRuns', scenarioRuns)

  // const handleExport = useCallback(() => {
  //   downloadCsv({
  //     filters,
  //     sorting,
  //     pagination,
  //     grouping,
  //     globalFilter,
  //   });
  // }, [downloadCsv, filters, sorting, pagination, grouping, globalFilter]);

  const table = useReactTable<ScenarioRunRow>({
    data: scenarioRuns ?? [],
    columns: columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // state: {
    //   sorting,
    //   columnVisibility,
    //   grouping,
    //   pagination,
    //   globalFilter,
    // },
    // onSortingChange: handlers.onSortingChange,
    // onGroupingChange: handlers.onGroupingChange,
    // onPaginationChange: handlers.onPaginationChange,
    // onGlobalFilterChange: handlers.onGlobalFilterChange,
    // onColumnVisibilityChange: handlers.onColumnVisibilityChange,
    debugAll: true,
  });

  console.log('render')

  if (!project) {
    return (
      <VStack gap={4} align="center" py={8}>
        <Text color="gray.500">Loading project...</Text>
      </VStack>
    )
  }

  return (
    <Box h="full">
      <DataGrid.Root>
        <DataGrid.Toolbar.Root>
          <DataGrid.Toolbar.LoadingIndicator
            isLoading={isLoading || isFetching}
          />
          <DataGrid.Toolbar.ResetFiltersAndSorting
            onResetFiltersAndSorting={() => {}}
          />
          <DataGrid.Toolbar.ColumnVisibility columns={table.getAllColumns()} />
          {/* <DataGrid.Toolbar.Export onExport={handleExport} /> */}
        </DataGrid.Toolbar.Root>
        <DataGrid.Table
          table={table}
          renderExpandedContent={renderExpandedContent}
        />
        <DataGrid.Pagination
          page={table.getState().pagination.pageIndex}
          pageSize={table.getState().pagination.pageSize}
          totalCount={table.getRowCount()}
          onPageChange={table.setPagination}
          onPageSizeChange={table.setPageSize}
        />
      </DataGrid.Root>
    </Box>
  );
}
