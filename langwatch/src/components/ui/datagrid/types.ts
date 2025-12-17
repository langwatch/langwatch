import type { ReactNode } from "react";
import type { CellContext, Row } from "@tanstack/react-table";

/**
 * Filter operators - simplified for initial implementation
 * - 'contains' for text columns (LIKE search)
 * - 'eq' for enum columns (exact match with dropdown)
 */
export type FilterOperator = "eq" | "contains";

/**
 * Filter state representing a single filter condition
 */
export interface FilterState {
  columnId: string;
  operator: FilterOperator;
  value: unknown;
}

/**
 * Filter type determines the UI and available operators for a column
 */
export type FilterType = "text" | "number" | "date" | "enum" | "boolean";

/**
 * Generic column definition for the DataGrid
 * @template T - The row data type
 */
export interface DataGridColumnDef<T> {
  /** Unique identifier for the column */
  id: string;

  /** Display header text */
  header: string;

  /** Key to access data from row (supports nested paths like 'metadata.user_id') */
  accessorKey?: keyof T | string;

  /** Custom cell renderer */
  cell?: (props: CellContext<T, unknown>) => ReactNode;

  /** Column width in pixels */
  width?: number;

  /** Minimum column width */
  minWidth?: number;

  /** Maximum column width */
  maxWidth?: number;

  /** Whether column is visible by default */
  defaultVisible?: boolean;

  /** Pin column to left or right */
  pinned?: "left" | "right" | false;

  /** Whether column can be filtered */
  filterable?: boolean;

  /** Type of filter UI to show */
  filterType?: FilterType;

  /** Available values for enum filter type */
  enumValues?: string[];

  /** Whether column can be sorted */
  sortable?: boolean;

  /** Default sort direction */
  defaultSort?: "asc" | "desc";

  /** Whether column can be used for grouping */
  groupable?: boolean;

  /** Function to generate link URL from row data */
  linkTo?: (row: T) => string;
}

/**
 * Sorting state
 */
export interface SortingState {
  columnId: string;
  order: "asc" | "desc";
}

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
 * Complete DataGrid state
 * @template T - The row data type
 */
export interface DataGridState<T> {
  // Data
  rows: T[];
  totalCount: number;
  isLoading: boolean;
  error: string | null;

  // Column state
  columns: DataGridColumnDef<T>[];
  visibleColumns: Set<string>;
  columnOrder: string[];
  pinnedColumns: { left: string[]; right: string[] };

  // Filter state
  filters: FilterState[];
  globalSearch: string;

  // Sort state
  sorting: SortingState | null;

  // Grouping state
  groupBy: string | null;

  // Pagination state
  page: number;
  pageSize: number;

  // Selection state
  selectedRows: Set<string>;

  // Expansion state
  expandedRows: Set<string>;

  // UI state
  isExporting: boolean;
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

  // Filter actions
  setFilters: (filters: FilterState[]) => void;
  addFilter: (filter: FilterState) => void;
  removeFilter: (columnId: string, index: number) => void;
  updateFilter: (index: number, filter: FilterState) => void;
  clearFilters: () => void;
  setGlobalSearch: (search: string) => void;

  // Sort actions
  setSorting: (sorting: SortingState | null) => void;
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
  columns: DataGridColumnDef<T>[];

  /** Default page size */
  defaultPageSize?: number;

  /** Default sorting */
  defaultSorting?: SortingState;

  /** Default filters */
  defaultFilters?: FilterState[];

  /** Default global search */
  defaultGlobalSearch?: string;

  /** Default page */
  defaultPage?: number;

  /** Function to get row ID */
  getRowId: (row: T) => string;

  /** Storage key for localStorage persistence */
  storageKey?: string;
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
