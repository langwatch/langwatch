import type { StateCreator } from "zustand";
import type { ExplorerStore } from "./explorerStore";

/**
 * The selection slice of the Explorer store: what the bulk actions act on.
 *
 * Two modes:
 * - "explicit": `traceIds` is the authoritative set the user picked
 * - "all-matching": all traces matching the current filter (capped server-side
 *   at 10,000 to match the export limit). `traceIds` is empty in this mode and
 *   bulk actions reuse the active filters/time range instead of an ID list.
 */
export type SelectionMode = "explicit" | "all-matching";

export interface Selection {
  mode: SelectionMode;
  traceIds: Set<string>;
}

export const EMPTY_SELECTION: Selection = {
  mode: "explicit",
  traceIds: new Set<string>(),
};

export interface SelectionSlice {
  selection: Selection;
  /**
   * The lens, query and window the current selection was made under, or null
   * before a page has said. The store outlives the page, so this is what
   * tells a remount whether the checked rows are still the rows listed.
   */
  selectionViewKey: string | null;

  toggleSelected: (traceId: string) => void;
  setSelectedMany: (traceIds: string[], checked: boolean) => void;
  selectAllMatching: () => void;
  clearSelection: () => void;
  /** Replace the selection whole, which is what a transform does. */
  setSelection: (selection: Selection) => void;
  /** Record the view the selection now belongs to. */
  setSelectionViewKey: (key: string) => void;
}

/**
 * An id made of nothing addresses no trace, and every bulk action downstream
 * would carry it to the server as if it did. Selection is where the ids leave
 * the table, so it is where they are refused; what a placeholder id looks like
 * belongs to the table that mints them, so that filter sits at the component
 * boundary feeding this store.
 */
const addressesATrace = (traceId: string): boolean => traceId.trim().length > 0;

export const createSelectionSlice: StateCreator<
  ExplorerStore,
  [],
  [],
  SelectionSlice
> = (set) => ({
  selection: EMPTY_SELECTION,
  selectionViewKey: null,

  toggleSelected: (traceId) =>
    set((state) => {
      if (!addressesATrace(traceId)) return state;
      const { selection } = state;
      const next = new Set(selection.traceIds);
      if (selection.mode === "all-matching") {
        // Toggling a row drops out of all-matching mode and starts an
        // explicit set seeded with whatever the user is doing now.
        next.add(traceId);
        return { selection: { mode: "explicit", traceIds: next } };
      }
      if (next.has(traceId)) next.delete(traceId);
      else next.add(traceId);
      return { selection: { mode: selection.mode, traceIds: next } };
    }),

  setSelectedMany: (traceIds, checked) =>
    set((state) => {
      const { selection } = state;
      const next =
        selection.mode === "all-matching"
          ? new Set<string>()
          : new Set(selection.traceIds);
      // Only an id that addresses a trace may enter; anything at all may leave,
      // so a selection can always be emptied.
      for (const id of checked ? traceIds.filter(addressesATrace) : traceIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return { selection: { mode: "explicit", traceIds: next } };
    }),

  selectAllMatching: () =>
    set({ selection: { mode: "all-matching", traceIds: new Set<string>() } }),

  clearSelection: () =>
    set({ selection: { mode: "explicit", traceIds: new Set<string>() } }),

  setSelection: (selection) => set({ selection }),

  setSelectionViewKey: (key) => set({ selectionViewKey: key }),
});

/**
 * The export endpoint enforces this same cap. We surface it client-side so the
 * "Select all N matching" affordance can show "10,000 selected (max)".
 */
export const SELECT_ALL_MATCHING_CAP = 10_000;
