import { useRef } from "react";

/**
 * Zustand store to manage TanStack Table controlled state
 * This ignore internally managed table state.
 */

import { create } from "zustand";
import type {
  GroupingState,
  ColumnFiltersState,
  PaginationState,
  RowSelectionState,
  ColumnPinningState,
  SortingState,
} from "@tanstack/react-table";


export interface DataGridStore {
  sorting: SortingState;
  setSorting: (updater: SortingState | ((s: SortingState) => SortingState)) => void;

  columnVisibility: Record<string, boolean>;
  setColumnVisibility: (updater: Record<string, boolean> | ((vis: Record<string, boolean>) => Record<string, boolean>)) => void;
  toggleColumnVisibility: (columnId: string) => void;

  grouping: GroupingState;
  setGrouping: (updater: GroupingState | ((g: GroupingState) => GroupingState)) => void;

  isSplit: boolean;
  setIsSplit: (isSplit: boolean) => void;

  rowSelection: RowSelectionState;
  setRowSelection: (updater: RowSelectionState | ((sel: RowSelectionState) => RowSelectionState)) => void;

  columnPinning: ColumnPinningState;
  setColumnPinning: (updater: ColumnPinningState | ((p: ColumnPinningState) => ColumnPinningState)) => void;

  columnFilters: ColumnFiltersState;
  setColumnFilters: (updater: ColumnFiltersState | ((f: ColumnFiltersState) => ColumnFiltersState)) => void;

  globalFilter: string;
  setGlobalFilter: (updater: string | ((g: string) => string)) => void;

  pagination: PaginationState;
  setPagination: (updater: PaginationState | ((p: PaginationState) => PaginationState)) => void;
}

const createStore = () => create<DataGridStore>((set) => ({
  sorting: [],
  setSorting: (updater) =>
    set((state) => ({
      sorting: typeof updater === "function" ? updater(state.sorting) : updater,
    })),

  columnVisibility: {},
  setColumnVisibility: (updater) =>
    set((state) => ({
      columnVisibility:
        typeof updater === "function" ? updater(state.columnVisibility) : updater,
    })),
  toggleColumnVisibility: (columnId) => {
    return set((state) => {
      state.setColumnVisibility({
        ...state.columnVisibility,
        [columnId]: !state.columnVisibility[columnId],
      });
      return state;
    })
  },

  grouping: [],
  setGrouping: (updater) =>
    set((state) => ({
      grouping: typeof updater === "function" ? updater(state.grouping) : updater,
    })),

  isSplit: false,
  setIsSplit: (isSplit) => set({ isSplit }),

  rowSelection: {},
  setRowSelection: (updater) =>
    set((state) => ({
      rowSelection:
        typeof updater === "function" ? updater(state.rowSelection) : updater,
    })),

  columnPinning: {},
  setColumnPinning: (updater) =>
    set((state) => ({
      columnPinning:
        typeof updater === "function" ? updater(state.columnPinning) : updater,
    })),

  columnFilters: [],
  setColumnFilters: (updater) =>
    set((state) => ({
      columnFilters:
        typeof updater === "function" ? updater(state.columnFilters) : updater,
    })),

  globalFilter: "",
  setGlobalFilter: (updater) =>
    set((state) => ({
      globalFilter:
        typeof updater === "function" ? updater(state.globalFilter) : updater,
    })),

  pagination: { pageIndex: 0, pageSize: 1 },
  setPagination: (updater) =>
    set((state) => ({
      pagination: typeof updater === "function" ? updater(state.pagination) : updater,
    })),
}));

export const dataGridStore = createStore();

export const useDataGridStore = () => {
  const storeRef = useRef<ReturnType<typeof createStore> | null>(null);

  if (storeRef.current === null) {
    storeRef.current = createStore();
  }

  return storeRef.current;
}
