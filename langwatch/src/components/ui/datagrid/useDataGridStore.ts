import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  DataGridStore,
  DataGridState,
  DataGridConfig,
} from "./types";
import { DataGridUrlParams } from "./datagrid-url-params.util";

/**
 * Creates initial state for the DataGrid store
 */
function createInitialState<T>(
  config: DataGridConfig<T>
): DataGridState<T> {
  // All columns visible by default
  const visibleColumns = new Set(config.columns.map((col) => col.id!));

  // No pinned columns by default (TanStack handles pinning via state)
  const pinnedLeft: string[] = [];
  const pinnedRight: string[] = [];

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
    sorting: config.defaultSorting ?? [],
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
 *
 * State priority (highest to lowest):
 * 1. URL params (if urlSync enabled) - enables shareable links
 * 2. localStorage (if storageKey provided) - persists UI preferences
 * 3. Config defaults
 *
 * @template T - The row data type
 */
export function createDataGridStore<T>(config: DataGridConfig<T>) {
  let initialState = createInitialState(config);

  // Apply URL state if urlSync is enabled (URL takes priority over defaults)
  if (config.urlSync) {
    const urlState = DataGridUrlParams.readFromURL();
    if (urlState.filters !== undefined) initialState.filters = urlState.filters;
    if (urlState.sorting !== undefined) initialState.sorting = urlState.sorting;
    if (urlState.page !== undefined) initialState.page = urlState.page;
    if (urlState.pageSize !== undefined) initialState.pageSize = urlState.pageSize;
    if (urlState.globalSearch !== undefined) initialState.globalSearch = urlState.globalSearch;
    if (urlState.groupBy !== undefined) initialState.groupBy = urlState.groupBy;
  }

  // Wrapper that syncs URL-syncable state changes to URL
  const createURLSyncedSet = (
    originalSet: (
      partial:
        | Partial<DataGridStore<T>>
        | ((state: DataGridStore<T>) => Partial<DataGridStore<T>>)
    ) => void,
    get: () => DataGridStore<T>
  ) => {
    if (!config.urlSync) return originalSet;

    return (
      partial:
        | Partial<DataGridStore<T>>
        | ((state: DataGridStore<T>) => Partial<DataGridStore<T>>)
    ) => {
      originalSet(partial);

      // After state update, sync URL-syncable fields to URL
      const state = get();
      DataGridUrlParams.writeToURL({
        filters: state.filters,
        sorting: state.sorting,
        page: state.page,
        pageSize: state.pageSize,
        globalSearch: state.globalSearch,
        groupBy: state.groupBy,
      });
    };
  };

  // If no storage key, create a non-persisted store
  if (!config.storageKey) {
    return create<DataGridStore<T>>()((set, get) =>
      createStoreActions(createURLSyncedSet(set, get), get, initialState, config)
    );
  }

  // No non-hideable columns (all columns can be hidden)
  const nonHideableColumnIds: string[] = [];

  // Create persisted store with optional URL sync
  return create<DataGridStore<T>>()(
    persist(
      (set, get) => createStoreActions(createURLSyncedSet(set, get), get, initialState, config),
      {
        name: config.storageKey,
        storage: createSetStorage(config.storageKey),
        partialize: (state) => ({
          // Only persist UI preferences to localStorage, not URL-synced state
          visibleColumns: state.visibleColumns,
          columnOrder: state.columnOrder,
          pinnedColumns: state.pinnedColumns,
          // Note: pageSize goes to URL if urlSync enabled, localStorage otherwise
          ...(config.urlSync ? {} : { pageSize: state.pageSize }),
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

    // Filter actions (using TanStack ColumnFiltersState directly)
    setFilters: (filters) => set({ filters, page: 1 }),
    addFilter: (columnId, value) =>
      set((state) => ({
        filters: [...state.filters, { id: columnId, value }],
        page: 1,
      })),
    removeFilter: (columnId, index) =>
      set((state) => {
        const columnFilters = state.filters.filter((f) => f.id === columnId);
        const filterToRemove = columnFilters[index];
        if (!filterToRemove) return state;

        return {
          filters: state.filters.filter((f) => f !== filterToRemove),
          page: 1,
        };
      }),
    updateFilter: (columnId, index, value) =>
      set((state) => {
        const columnFilters = state.filters.filter((f) => f.id === columnId);
        const filterToUpdate = columnFilters[index];
        if (!filterToUpdate) return state;

        const newFilters = [...state.filters];
        const globalIndex = state.filters.indexOf(filterToUpdate);
        newFilters[globalIndex] = { id: columnId, value };
        return { filters: newFilters, page: 1 };
      }),
    clearFilters: () => set({ filters: [], globalSearch: "", page: 1 }),
    resetFiltersAndSorting: () => set({ filters: [], globalSearch: "", sorting: [], groupBy: null, page: 1 }),
    setGlobalSearch: (globalSearch) => set({ globalSearch, page: 1 }),

    // Sort actions (using TanStack SortingState - array format)
    setSorting: (sorting) => set({ sorting }),
    toggleSort: (columnId) =>
      set((state) => {
        const column = state.columns.find((c) => c.id === columnId);
        if (!column?.enableSorting) return state;

        const existingIndex = state.sorting.findIndex((s) => s.id === columnId);
        if (existingIndex >= 0) {
          const existing = state.sorting[existingIndex];
          // Toggle direction or remove
          if (existing.desc) {
            // Remove from array
            return { sorting: state.sorting.filter((_, i) => i !== existingIndex) };
          }
          // Change to desc
          const newSorting = [...state.sorting];
          newSorting[existingIndex] = { id: columnId, desc: true };
          return { sorting: newSorting };
        }
        // Add new sort (asc)
        return { sorting: [...state.sorting, { id: columnId, desc: false }] };
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
