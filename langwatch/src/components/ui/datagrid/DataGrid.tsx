import type { ReactNode } from "react";
import { Box, Flex, Spinner, Text } from "@chakra-ui/react";
import { DataGridToolbar } from "./DataGridToolbar";
import { DataGridTable } from "./DataGridTable";
import { DataGridPagination } from "./DataGridPagination";
import type {
  DataGridColumnDef,
  DataGridStore,
  FilterState,
  SortingState,
} from "./types";

interface DataGridProps<T> {
  /** Store instance from createDataGridStore */
  store: DataGridStore<T>;
  /** Function to get row ID */
  getRowId: (row: T) => string;
  /** Render function for expanded row content */
  renderExpandedContent?: (row: T) => ReactNode;
  /** Function to get enum options for a column (for dynamic options) */
  getEnumOptions?: (columnId: string) => string[];
  /** Callback when filters/sorting/pagination/groupBy changes (for data fetching) */
  onStateChange?: (state: {
    filters: FilterState[];
    sorting: SortingState | null;
    page: number;
    pageSize: number;
    globalSearch: string;
    groupBy: string | null;
  }) => void;
  /** Callback for CSV export */
  onExport?: () => void;
  /** Callback for refresh */
  onRefresh?: () => void;
  /** Empty state message */
  emptyMessage?: string;
  /** Error state message */
  errorMessage?: string;
}

/**
 * Main DataGrid component that composes toolbar, table, and pagination
 */
export function DataGrid<T>({
  store,
  getRowId,
  renderExpandedContent,
  getEnumOptions,
  onStateChange,
  onExport,
  onRefresh,
  emptyMessage = "No data available",
  errorMessage,
}: DataGridProps<T>) {
  const {
    rows,
    totalCount,
    isLoading,
    error,
    columns,
    visibleColumns,
    filters,
    globalSearch,
    sorting,
    groupBy,
    page,
    pageSize,
    expandedRows,
    isExporting,
    // Actions
    addFilter,
    removeFilter,
    clearFilters,
    resetFiltersAndSorting,
    setGlobalSearch,
    setSorting,
    setGroupBy,
    setPage,
    setPageSize,
    toggleColumnVisibility,
    pinColumn,
    toggleRowExpansion,
    setIsExporting,
  } = store;

  // Handle sort change
  const handleSort = (columnId: string, order: "asc" | "desc" | null) => {
    const newSorting = order ? { columnId, order } : null;
    setSorting(newSorting);
    onStateChange?.({
      filters,
      sorting: newSorting,
      page,
      pageSize,
      globalSearch,
      groupBy,
    });
  };

  // Handle filter add
  const handleAddFilter = (filter: FilterState) => {
    addFilter(filter);
    onStateChange?.({
      filters: [...filters, filter],
      sorting,
      page: 1,
      pageSize,
      globalSearch,
      groupBy,
    });
  };

  // Handle filter remove
  const handleRemoveFilter = (columnId: string, index: number) => {
    removeFilter(columnId, index);
    const columnFilters = filters.filter((f) => f.columnId === columnId);
    const filterToRemove = columnFilters[index];
    const newFilters = filters.filter((f) => f !== filterToRemove);
    onStateChange?.({
      filters: newFilters,
      sorting,
      page: 1,
      pageSize,
      globalSearch,
      groupBy,
    });
  };

  // Handle clear filters
  const handleClearFilters = () => {
    clearFilters();
    onStateChange?.({
      filters: [],
      sorting,
      page: 1,
      pageSize,
      globalSearch: "",
      groupBy,
    });
  };

  // Handle reset all filters and sorting
  const handleResetFiltersAndSorting = () => {
    resetFiltersAndSorting();
    onStateChange?.({
      filters: [],
      sorting: null,
      page: 1,
      pageSize,
      globalSearch: "",
      groupBy: null,
    });
  };

  // Handle global search
  const handleGlobalSearchChange = (search: string) => {
    setGlobalSearch(search);
    onStateChange?.({
      filters,
      sorting,
      page: 1,
      pageSize,
      globalSearch: search,
      groupBy,
    });
  };

  // Handle page change
  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    onStateChange?.({
      filters,
      sorting,
      page: newPage,
      pageSize,
      globalSearch,
      groupBy,
    });
  };

  // Handle page size change
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    onStateChange?.({
      filters,
      sorting,
      page: 1,
      pageSize: newPageSize,
      globalSearch,
      groupBy,
    });
  };

  // Handle group by change
  const handleGroupBy = (columnId: string | null) => {
    setGroupBy(columnId);
    onStateChange?.({
      filters,
      sorting,
      page: 1,
      pageSize,
      globalSearch,
      groupBy: columnId,
    });
  };

  // Handle export
  const handleExport = async () => {
    if (onExport) {
      setIsExporting(true);
      try {
        await onExport();
      } finally {
        setIsExporting(false);
      }
    }
  };

  // Error state
  if (error) {
    return (
      <Box p={8} textAlign="center">
        <Text color="red.500" mb={4}>
          {errorMessage ?? error}
        </Text>
        {onRefresh && (
          <button onClick={onRefresh}>Retry</button>
        )}
      </Box>
    );
  }

  return (
    <Flex direction="column" h="full" bg="white" borderRadius="md" shadow="sm">
      {/* Toolbar */}
      <DataGridToolbar
        columns={columns}
        visibleColumns={visibleColumns}
        filters={filters}
        globalSearch={globalSearch}
        sorting={sorting}
        groupBy={groupBy}
        isExporting={isExporting}
        onRemoveFilter={handleRemoveFilter}
        onClearFilters={handleClearFilters}
        onResetFiltersAndSorting={handleResetFiltersAndSorting}
        onGlobalSearchChange={handleGlobalSearchChange}
        onToggleColumnVisibility={toggleColumnVisibility}
        onExport={handleExport}
        onRefresh={onRefresh}
      />

      {/* Table */}
      <Box flex={1} overflow="auto">
        <DataGridTable
          data={rows}
          columns={columns}
          visibleColumns={visibleColumns}
          sorting={sorting}
          filters={filters}
          groupBy={groupBy}
          expandedRows={expandedRows}
          getRowId={getRowId}
          onSort={handleSort}
          onAddFilter={handleAddFilter}
          onRemoveFilter={handleRemoveFilter}
          onGroupBy={handleGroupBy}
          onToggleColumnVisibility={toggleColumnVisibility}
          onPinColumn={pinColumn}
          onToggleRowExpansion={toggleRowExpansion}
          renderExpandedContent={renderExpandedContent}
          getEnumOptions={getEnumOptions}
          isLoading={isLoading}
          emptyMessage={emptyMessage}
        />
      </Box>

      {/* Pagination */}
      <DataGridPagination
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />
    </Flex>
  );
}
