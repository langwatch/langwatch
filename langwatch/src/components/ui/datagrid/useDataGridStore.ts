import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  DataGridStore,
  DataGridState,
  DataGridConfig,
} from "./types";

/**
 * Creates initial state for the DataGrid store
 */
function createInitialState<T>(
  config: DataGridConfig<T>
): DataGridState<T> {
  const visibleColumns = new Set(
    config.columns
      .filter((col) => col.defaultVisible !== false)
      .map((col) => col.id)
  );

  const pinnedLeft = config.columns
    .filter((col) => col.pinned === "left")
    .map((col) => col.id);

  const pinnedRight = config.columns
    .filter((col) => col.pinned === "right")
    .map((col) => col.id);

  return {
    rows: [],
    totalCount: 0,
    isLoading: false,
    error: null,
    columns: config.columns,
    visibleColumns,
    columnOrder: config.columns.map((col) => col.id),
    pinnedColumns: { left: pinnedLeft, right: pinnedRight },
    filters: config.defaultFilters ?? [],
    globalSearch: config.defaultGlobalSearch ?? "",
    sorting: config.defaultSorting ?? null,
    groupBy: null,
    page: config.defaultPage ?? 1,
    pageSize: config.defaultPageSize ?? 20,
    selectedRows: new Set(),
    expandedRows: new Set(),
    isExporting: false,
  };
}

/**
 * Custom storage that handles Set serialization for localStorage
 */
const createSetStorage = (storageKey: string) =>
  createJSONStorage<Partial<DataGridState<unknown>>>(() => localStorage, {
    reviver: (_key, value) => {
      // Revive Sets from arrays
      if (
        value &&
        typeof value === "object" &&
        "__set" in value &&
        Array.isArray((value as { __set: unknown[] }).__set)
      ) {
        return new Set((value as { __set: unknown[] }).__set);
      }
      return value;
    },
    replacer: (_key, value) => {
      // Serialize Sets as arrays
      if (value instanceof Set) {
        return { __set: Array.from(value) };
      }
      return value;
    },
  });

/**
 * Creates a DataGrid store with the given configuration
 * @template T - The row data type
 */
export function createDataGridStore<T>(config: DataGridConfig<T>) {
  const initialState = createInitialState(config);

  // If no storage key, create a non-persisted store
  if (!config.storageKey) {
    return create<DataGridStore<T>>()((set, get) =>
      createStoreActions(set, get, initialState, config)
    );
  }

  // Get non-hideable column IDs to ensure they're always visible
  const nonHideableColumnIds = config.columns
    .filter((col) => col.hideable === false)
    .map((col) => col.id);

  // Create persisted store
  return create<DataGridStore<T>>()(
    persist(
      (set, get) => createStoreActions(set, get, initialState, config),
      {
        name: config.storageKey,
        storage: createSetStorage(config.storageKey),
        partialize: (state) => ({
          // Only persist UI preferences, not data
          visibleColumns: state.visibleColumns,
          columnOrder: state.columnOrder,
          pinnedColumns: state.pinnedColumns,
          pageSize: state.pageSize,
        }),
        merge: (persistedState, currentState) => {
          const merged = { ...currentState, ...(persistedState as object) };
          // Ensure non-hideable columns are always visible
          if (merged.visibleColumns instanceof Set) {
            for (const colId of nonHideableColumnIds) {
              merged.visibleColumns.add(colId);
            }
          }
          return merged;
        },
      }
    )
  );
}

/**
 * Creates store actions
 */
function createStoreActions<T>(
  set: (
    partial:
      | Partial<DataGridStore<T>>
      | ((state: DataGridStore<T>) => Partial<DataGridStore<T>>)
  ) => void,
  get: () => DataGridStore<T>,
  initialState: DataGridState<T>,
  config: DataGridConfig<T>
): DataGridStore<T> {
  return {
    ...initialState,

    // Data actions
    setRows: (rows) => set({ rows }),
    setTotalCount: (totalCount) => set({ totalCount }),
    setIsLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),

    // Filter actions
    setFilters: (filters) => set({ filters, page: 1 }),
    addFilter: (filter) =>
      set((state) => ({
        filters: [...state.filters, filter],
        page: 1,
      })),
    removeFilter: (columnId, index) =>
      set((state) => {
        const columnFilters = state.filters.filter(
          (f) => f.columnId === columnId
        );
        const filterToRemove = columnFilters[index];
        if (!filterToRemove) return state;

        return {
          filters: state.filters.filter((f) => f !== filterToRemove),
          page: 1,
        };
      }),
    updateFilter: (index, filter) =>
      set((state) => {
        const newFilters = [...state.filters];
        newFilters[index] = filter;
        return { filters: newFilters, page: 1 };
      }),
    clearFilters: () => set({ filters: [], globalSearch: "", page: 1 }),
    resetFiltersAndSorting: () => set({ filters: [], globalSearch: "", sorting: null, groupBy: null, page: 1 }),
    setGlobalSearch: (globalSearch) => set({ globalSearch, page: 1 }),

    // Sort actions
    setSorting: (sorting) => set({ sorting }),
    toggleSort: (columnId) =>
      set((state) => {
        const column = state.columns.find((c) => c.id === columnId);
        if (!column?.sortable) return state;

        if (state.sorting?.columnId === columnId) {
          // Toggle direction or clear
          if (state.sorting.order === "asc") {
            return { sorting: { columnId, order: "desc" } };
          }
          return { sorting: null };
        }
        return { sorting: { columnId, order: "asc" } };
      }),

    // Grouping actions
    setGroupBy: (groupBy) => set({ groupBy }),

    // Pagination actions
    setPage: (page) => set({ page }),
    setPageSize: (pageSize) => set({ pageSize, page: 1 }),

    // Column actions
    setColumns: (columns) => set({ columns }),
    toggleColumnVisibility: (columnId) =>
      set((state) => {
        // Check if column is hideable
        const column = state.columns.find((c) => c.id === columnId);
        if (column?.hideable === false) {
          // Cannot hide this column
          return state;
        }

        const newVisibleColumns = new Set(state.visibleColumns);
        if (newVisibleColumns.has(columnId)) {
          newVisibleColumns.delete(columnId);
        } else {
          newVisibleColumns.add(columnId);
        }
        return { visibleColumns: newVisibleColumns };
      }),
    setColumnOrder: (columnOrder) => set({ columnOrder }),
    pinColumn: (columnId, position) =>
      set((state) => {
        const newPinnedColumns = {
          left: state.pinnedColumns.left.filter((id) => id !== columnId),
          right: state.pinnedColumns.right.filter((id) => id !== columnId),
        };

        if (position === "left") {
          newPinnedColumns.left.push(columnId);
        } else if (position === "right") {
          newPinnedColumns.right.push(columnId);
        }

        return { pinnedColumns: newPinnedColumns };
      }),
    setVisibleColumns: (visibleColumns) => set({ visibleColumns }),

    // Selection actions
    toggleRowSelection: (rowId) =>
      set((state) => {
        const newSelectedRows = new Set(state.selectedRows);
        if (newSelectedRows.has(rowId)) {
          newSelectedRows.delete(rowId);
        } else {
          newSelectedRows.add(rowId);
        }
        return { selectedRows: newSelectedRows };
      }),
    selectAllRows: () =>
      set((state) => ({
        selectedRows: new Set(state.rows.map((row) => config.getRowId(row))),
      })),
    clearSelection: () => set({ selectedRows: new Set() }),

    // Expansion actions
    toggleRowExpansion: (rowId) =>
      set((state) => {
        const newExpandedRows = new Set(state.expandedRows);
        if (newExpandedRows.has(rowId)) {
          newExpandedRows.delete(rowId);
        } else {
          newExpandedRows.add(rowId);
        }
        return { expandedRows: newExpandedRows };
      }),
    expandAllRows: () =>
      set((state) => ({
        expandedRows: new Set(state.rows.map((row) => config.getRowId(row))),
      })),
    collapseAllRows: () => set({ expandedRows: new Set() }),

    // Export actions
    setIsExporting: (isExporting) => set({ isExporting }),

    // Reset
    reset: () => set(initialState),
  };
}
