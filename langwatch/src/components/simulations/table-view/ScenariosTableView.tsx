import { useCallback, useMemo } from "react";
import { Box, Spacer, Text, VStack } from "@chakra-ui/react";
import { DataGrid } from "~/components/ui/datagrid";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { createScenarioColumns } from "./scenarioColumns";
import { ScenarioExpandedContent } from "./ScenarioExpandedContent";
import type { ScenarioRunRow } from "./types";
import { useExportScenarioRuns } from "~/features/simulations/hooks/useExportScenarioRuns";
import {
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  getGroupedRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  type Row,
} from "@tanstack/react-table";

const columns = createScenarioColumns();

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

  const table = useReactTable<ScenarioRunRow>({
    data: scenarioRuns as ScenarioRunRow[],
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
        "results.metCriteria": false,
        "results.unmetCriteria": false,
        "results.reasoning": false,
        "results.error": false,
        "metadata.traces": false,
      },
    },
  });

  const handleRowClick = (row: Row<ScenarioRunRow>) => {
    // Open the run in a new tab
    window.open(
      `/${project?.slug}/simulations/${row.original.scenarioSetId}/${row.original.batchRunId}/${row.original.scenarioRunId}`,
      "_blank"
    );
  };

  if (!project) {
    return (
      <VStack gap={4} align="center" py={8}>
        <Text color="gray.500">Loading project...</Text>
      </VStack>
    );
  }

  const handleExport = useCallback(() => {
    // Get all visible column headers
    const headers = table
      .getHeaderGroups()
      .flatMap((headerGroup) =>
        headerGroup.headers
          .filter((header) => header.column.getIsVisible())
          .map((header) => header.column.columnDef.header as string)
      );

    // Export ALL rows from scenarioRuns, not just the paginated table rows
    const rows = scenarioRuns.map((row) => {
      return table
        .getAllColumns()
        .filter((col) => col.getIsVisible())
        .map((col) => {
          // Use the column's accessorFn to get the formatted value
          const rawValue = col.accessorFn
            ? col.accessorFn(row as ScenarioRunRow, 0)
            : (row as any)[col.id];

          // Handle arrays and objects
          if (Array.isArray(rawValue)) {
            return rawValue.join(", ");
          } else if (typeof rawValue === "object" && rawValue !== null) {
            return JSON.stringify(rawValue);
          }

          return rawValue ?? "";
        });
    });

    downloadCsv({
      headers,
      rows,
    });
  }, [downloadCsv, scenarioRuns, table]);

  return (
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
        onRowClick={handleRowClick}
      />
      <DataGrid.Pagination
        page={table.getState().pagination.pageIndex + 1}
        pageSize={table.getState().pagination.pageSize}
        totalCount={table.getRowCount()}
        onPageChange={(page) => table.setPageIndex(page - 1)}
        onPageSizeChange={(pageSize) => table.setPageSize(pageSize)}
      />
    </DataGrid.Root>
  );
}
