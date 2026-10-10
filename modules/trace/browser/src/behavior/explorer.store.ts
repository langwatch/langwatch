import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { createQuerySlice, type QuerySlice } from "./query.slice.ts";
import { createRowsSlice, type RowsSlice } from "./rows.slice.ts";
import { createSelectionSlice, type SelectionSlice } from "./selection.slice.ts";
import {
  createViewSlice,
  getEffectiveLens,
  type LensConfig,
  type ViewSlice,
} from "./view.slice.ts";

/**
 * The one store behind the Trace Explorer page. A slice reaches another
 * through `get()`, never a second store, so a lens switch installs its filter
 * inside one state write.
 * @see dev/docs/adr/152-the-explorer-is-one-store-with-pure-transforms.md
 */
export type ExplorerStore = QuerySlice & ViewSlice & SelectionSlice & RowsSlice;

export const useExplorerStore = create<ExplorerStore>()((...args) => ({
  ...createQuerySlice(...args),
  ...createViewSlice(...args),
  ...createSelectionSlice(...args),
  ...createRowsSlice(...args),
}));

/**
 * The names the page used while the Explorer kept three stores. They address
 * the one store; a selector written against any slice still resolves.
 */
export const useFilterStore = useExplorerStore;
export const useViewStore = useExplorerStore;
export const useSelectionStore = useExplorerStore;

/**
 * The canonical filter text without the React hook, for readers that act on
 * the store from outside a component (the lens sync bridge, for one).
 */
export function getCurrentFilterText(): string {
  try {
    return useExplorerStore.getState().queryText;
  } catch {
    return "";
  }
}

/**
 * The effective lens as a stable subscription: the slices are compared
 * shallowly and the derived object is memoised, so the store snapshot settles
 * instead of re-rendering the table forever.
 */
export function useEffectiveLens(): LensConfig | null {
  const slices = useExplorerStore(
    useShallow((state) => ({
      allLenses: state.allLenses,
      activeLensId: state.activeLensId,
      sort: state.sort,
      grouping: state.grouping,
      columnOrder: state.columnOrder,
    })),
  );
  return useMemo(() => getEffectiveLens(slices), [slices]);
}
