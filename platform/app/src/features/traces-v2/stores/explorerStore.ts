import { create } from "zustand";
import { createQuerySlice, type QuerySlice } from "./querySlice";
import { createRowsSlice, type RowsSlice } from "./rowsSlice";
import { createSelectionSlice, type SelectionSlice } from "./selectionSlice";
import { createViewSlice, type ViewSlice } from "./viewSlice";

/**
 * The one store behind the Trace Explorer page.
 *
 * Four slices, one state: the query, window and pagination (`querySlice`),
 * the lens, sort, grouping and columns (`viewSlice`), the selection
 * (`selectionSlice`) and the open rows plus the last read's counts
 * (`rowsSlice`). A slice reaches another through `get()`, never through a
 * second store, so a lens switch installs its filter and a sort change drops
 * the keyset cursors inside one state write.
 *
 * The page state a transform reads and writes is the {@link ExplorerState}
 * pick over this store (`actions/transforms/types.ts`); everything else here
 * is either derived (the AST, the debounced copies, the cursors) or a
 * behaviour the page owns (the lens registry and its drafts).
 *
 * Peripheral stores stay where they are: the drawer, the column sizing, the
 * density, the facet sidebar, the refresh timer and the polled Instant Eval
 * counters are not the page's address and are not transformed.
 *
 * @see dev/docs/adr/140-the-explorer-is-one-store-with-pure-transforms.md
 * @see specs/traces-v2/explorer-actions.feature
 */
export type ExplorerStore = QuerySlice & ViewSlice & SelectionSlice & RowsSlice;

export const useExplorerStore = create<ExplorerStore>()((...args) => ({
  ...createQuerySlice(...args),
  ...createViewSlice(...args),
  ...createSelectionSlice(...args),
  ...createRowsSlice(...args),
}));

/**
 * The canonical filter text without the React hook, for modules that act on
 * the store from outside a component (the lens sync bridge, for one).
 */
export function getCurrentFilterText(): string {
  try {
    return useExplorerStore.getState().queryText;
  } catch {
    return "";
  }
}
