import { useCallback, useMemo } from "react";
import { Box, Spacer, Text, VStack } from "@chakra-ui/react";
import { DataGrid } from "~/components/ui/datagrid";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { createScenarioColumns } from "./scenarioColumns";
import { ScenarioExpandedContent } from "./ScenarioExpandedContent";
import type { ScenarioRunRow } from "./types";
import {
  dataGridStore,
  useDataGridStore,
} from "~/components/ui/datagrid/useDataGridStore.v2";
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
 */
export function ScenariosTableView() {
  const { project } = useOrganizationTeamProject();
  const { downloadCsv } = useExportScenarioRuns();

  const { data, isLoading, isFetching, error } =
    api.scenarios.getAllScenarioRunsWithTraces.useQuery(
      {
        projectId: project?.id ?? "",
      },
      {
        enabled: !!project,
        refetchInterval: 30000,
      }
    );

  const scenarioRuns = useMemo(() => data ?? [], [data]);

  // Render expanded content
  const renderExpandedContent = useCallback(
    (row: Row<ScenarioRunRow>) => <ScenarioExpandedContent row={row} />,
    []
  );

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
    enableGrouping: false,
    initialState: {
      columnVisibility: {
        batchRunId: false,
        scenarioRunId: false,
        scenarioId: false,
        messages: false,
        description: false,
        'results.metCriteria': false,
        'results.unmetCriteria': false,
        'results.error': false,
        'metadata.traces': false,
      },
    },
    onRowClick: (row) => {
      // Open the run in a new tab
      window.open(`/${project?.slug}/simulations/${row.original.scenarioSetId}/${row.original.batchRunId}/${row.original.scenarioRunId}`, '_blank');
    },
    debugAll: true,
  });

  if (!project) {
    return (
      <VStack gap={4} align="center" py={8}>
        <Text color="gray.500">Loading project...</Text>
      </VStack>
    );
  }

  const handleExport = useCallback(() => {
    const headers = table
      .getHeaderGroups()
      .map((x) => x.headers)
      .flat();

    const rows = table.getRowModel().rows;

    downloadCsv({
      data: {
        headers,
        rows,
      },
    });
  }, [downloadCsv, table]);

  return (
    <Box h="full">
      <DataGrid.Root>
        <DataGrid.Toolbar.Root mb={2}>
          <DataGrid.Toolbar.Search
            value={table.getState().globalFilter}
            onChange={(value) => table.setGlobalFilter(value)}
          />
          <Spacer />
          <DataGrid.Toolbar.LoadingIndicator
            isLoading={isLoading || isFetching}
          />
          <DataGrid.Toolbar.ResetFiltersAndSorting
            onResetFiltersAndSorting={table.reset}
          />
          <DataGrid.Toolbar.ColumnVisibility columns={table.getAllColumns()} />
          <DataGrid.Toolbar.Export onExport={handleExport} />
        </DataGrid.Toolbar.Root>
          <DataGrid.Table
          table={table}
          renderExpandedContent={renderExpandedContent}
        />
        <DataGrid.Pagination
          page={table.getState().pagination.pageIndex + 1}
          pageSize={table.getState().pagination.pageSize}
          totalCount={table.getRowCount()}
          onPageChange={table.setPagination}
          onPageSizeChange={table.setPageSize}
        />
      </DataGrid.Root>
    </Box>
  );
}
