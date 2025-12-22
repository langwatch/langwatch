import { useCallback } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import { DataGrid } from "~/components/ui/datagrid";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { createScenarioColumns } from "./scenarioColumns";
import { ScenarioExpandedContent } from "./ScenarioExpandedContent";
import type { ScenarioRunRow } from "./types";
import { useDataGridStore } from "~/components/ui/datagrid/useDataGridStore.v2";
import { useExportScenarioRuns } from "~/features/simulations/hooks/useExportScenarioRuns";
import {
  getCoreRowModel,
  type Row,
  useReactTable,
} from "@tanstack/react-table";

const columns = createScenarioColumns();

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
  const { downloadCsv } = useExportScenarioRuns();

  // Use the store - this is the Zustand hook pattern
  const store = useDataGridStore();

  // Subscribe to specific state slices to avoid re-renders on every state change
  const filters = store((state) => state.columnFilters);
  const grouping = store((state) => state.grouping);
  const sorting = store((state) => state.sorting);
  const pagination = store((state) => state.pagination);
  const columnVisibility = store((state) => state.columnVisibility);
  const globalFilter = store((state) => state.globalFilter);
  const toggleColumnVisibility = store((state) => state.toggleColumnVisibility);

  // Fetch filtered scenario runs (ungrouped)
  const {
    data: scenarioRuns,
    isLoading: isLoadingScenarioRuns,
    isFetching: isFetchingScenarioRuns,
    error: errorScenarioRuns,
  } = api.scenarios.fetchScenarioRuns.useQuery(
    {
      projectId: project?.id ?? "",
      filters,
      sorting,
      pagination,
      grouping,
      globalFilter,
    },
    {
      enabled: !!project?.id,
      refetchInterval: 30000,
    }
  );

  const isLoading = isLoadingScenarioRuns;
  const isFetching = isFetchingScenarioRuns;
  const error = errorScenarioRuns;

  // Render expanded content
  const renderExpandedContent = useCallback(
    (row: Row<ScenarioRunRow>) => <ScenarioExpandedContent row={row} />,
    []
  );

  const handleExport = useCallback(() => {
    downloadCsv({
      filters,
      sorting,
      pagination,
      grouping,
      globalFilter,
    });
  }, [downloadCsv, filters, sorting, pagination, grouping, globalFilter]);

  const table = useReactTable<ScenarioRunRow>({
    data: scenarioRuns ?? [],
    columns: columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!project) {
    return (
      <VStack gap={4} align="center" py={8}>
        <Text color="gray.500">Loading project...</Text>
      </VStack>
    );
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
          <DataGrid.Toolbar.ColumnVisibility
            columns={table._getColumnDefs()}
            visibleColumns={columnVisibility}
            onToggleColumnVisibility={toggleColumnVisibility}
          />
          <DataGrid.Toolbar.Export onExport={handleExport} />
        </DataGrid.Toolbar.Root>
        <DataGrid.Table
          table={table}
          renderExpandedContent={renderExpandedContent}
        />
        {/* <DataGrid.Pagination /> */}
      </DataGrid.Root>
    </Box>
  );
}
