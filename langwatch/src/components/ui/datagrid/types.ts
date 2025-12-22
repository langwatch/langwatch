import type { Row, ColumnDef, GroupingState, PaginationState, SortingState, ColumnFiltersState } from "@tanstack/react-table";

/**
 * Filter operators - simplified for initial implementation
 * - 'contains' for text columns (LIKE search)
 * - 'eq' for enum columns (exact match with dropdown)
 */
export type FilterOperator = "eq" | "contains" | "between";

/**
 * Filter type determines the UI and available operators for a column
 */
export type FilterType = "text" | "number" | "date" | "enum" | "boolean";


// Re-export TanStack types for convenience
export type { SortingState, ColumnFiltersState };

/**
 * URL query parameters for shareable state
 */
export interface DataGridURLParams {
  /** View mode */
  view?: "grid" | "table";

  /** Filters encoded as JSON string */
  filters?: string;

  /** Column to sort by */
  sortBy?: string;

  /** Sort direction */
  sortOrder?: "asc" | "desc";

  /** Current page number */
  page?: number;

  /** Items per page */
  pageSize?: number;

  /** Visible columns as comma-separated string */
  columns?: string;

  /** Column to group by */
  groupBy?: string;

  /** Global search query */
  search?: string;

  /** Expanded row IDs as comma-separated string */
  expanded?: string;
}

/**
 * Actions for DataGrid store
 * @template T - The row data type
 */
export interface DataGridActions<T> {
  // Data actions
  setRows: (rows: T[]) => void;
  setTotalCount: (count: number) => void;
  setIsLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;

  // Filter actions (using TanStack ColumnFiltersState directly)
  setFilters: (filters: ColumnFiltersState) => void;
  addFilter: (columnId: string, value: unknown) => void;
  removeFilter: (columnId: string, index: number) => void;
  updateFilter: (columnId: string, index: number, value: unknown) => void;
  clearFilters: () => void;
  resetFiltersAndSorting: () => void;
  setGlobalSearch: (search: string) => void;

  // Sort actions
  setSorting: (sorting: SortingState) => void;
  toggleSort: (columnId: string) => void;

  // Grouping actions
  setGroupBy: (columnId: string | null) => void;

  // Pagination actions
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;

  // Column actions
  setColumns: (columns: DataGridColumnDef<T>[]) => void;
  toggleColumnVisibility: (columnId: string) => void;
  setColumnOrder: (order: string[]) => void;
  pinColumn: (columnId: string, position: "left" | "right" | false) => void;
  setVisibleColumns: (columns: Set<string>) => void;

  // Selection actions
  toggleRowSelection: (rowId: string) => void;
  selectAllRows: () => void;
  clearSelection: () => void;

  // Expansion actions
  toggleRowExpansion: (rowId: string) => void;
  expandAllRows: () => void;
  collapseAllRows: () => void;

  // Export actions
  setIsExporting: (isExporting: boolean) => void;

  // Reset
  reset: () => void;
}

/**
 * Combined store type
 * @template T - The row data type
 */
export type DataGridStore<T> = DataGridState<T> & DataGridActions<T>;

/**
 * Configuration for creating a DataGrid store
 * @template T - The row data type
 */
export interface DataGridConfig<T> {
  /** Column definitions */
  columns: ColumnDef<T, unknown>[];

  /** Default page size */
  defaultPageSize?: number;

  /** Default sorting (TanStack SortingState - array format) */
  defaultSorting?: SortingState;

  /** Default filters (TanStack ColumnFiltersState) */
  defaultFilters?: ColumnFiltersState;

  /** Default global search */
  defaultGlobalSearch?: string;

  /** Default page */
  defaultPage?: number;

  /** Function to get row ID */
  getRowId: (row: T) => string;

  /** Storage key for localStorage persistence */
  storageKey?: string;

  /**
   * Enable URL sync for shareable table state.
   * When true, filters/sorting/pagination sync to URL query params.
   * URL state takes priority over localStorage on mount.
   */
  urlSync?: boolean;
}

/**
 * Props for expandable row content
 * @template T - The row data type
 */
export interface ExpandedRowContentProps<T> {
  row: Row<T>;
  data: T;
}


/**
 * Group header data for grouped rows
 */
export interface GroupHeader {
  columnId: string;
  value: string;
  count: number;
  passRate?: number;
}
