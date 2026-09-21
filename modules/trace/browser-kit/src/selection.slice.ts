import type { StateCreator } from "zustand";

import type { ExplorerStore } from "./explorer.store.ts";

/**
 * The selection slice of the Explorer store: what the bulk actions act on.
 * "explicit" is the set the reader picked; "all-matching" is every trace the
 * filter answers, capped server-side, and names no ids of its own.
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
   * before a page has said. The store outlives the page, so this is what tells
   * a remount whether the checked rows are still the rows listed.
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
 * would carry it to the server as if it did.
 */
const addressesATrace = (traceId: string): boolean => traceId.trim().length > 0;

/**
 * The selection with `traceIds` added or removed. Leaving all-matching mode
 * starts from an empty set; only an id that addresses a trace may enter, and
 * anything at all may leave, so a selection can always be emptied.
 */
function withMembers({
  selection,
  traceIds,
  checked,
}: {
  selection: Selection;
  traceIds: string[];
  checked: boolean;
}): Selection {
  const next = selection.mode === "all-matching" ? new Set<string>() : new Set(selection.traceIds);
  for (const id of checked ? traceIds.filter(addressesATrace) : traceIds) {
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
  }
  return { mode: "explicit", traceIds: next };
}

export const createSelectionSlice: StateCreator<ExplorerStore, [], [], SelectionSlice> = (set) => ({
  selection: EMPTY_SELECTION,
  selectionViewKey: null,

  toggleSelected: (traceId) =>
    set((state) => {
      if (!addressesATrace(traceId)) {
        return state;
      }
      const { selection } = state;
      const next = new Set(selection.traceIds);
      if (selection.mode === "all-matching") {
        // Toggling a row drops out of all-matching mode and starts an explicit
        // set seeded with whatever the reader is doing now.
        next.add(traceId);
        return { selection: { mode: "explicit", traceIds: next } };
      }
      if (next.has(traceId)) {
        next.delete(traceId);
      } else {
        next.add(traceId);
      }
      return { selection: { mode: selection.mode, traceIds: next } };
    }),

  setSelectedMany: (traceIds, checked) =>
    set((state) => ({
      selection: withMembers({ selection: state.selection, traceIds, checked }),
    })),

  selectAllMatching: () =>
    set({ selection: { mode: "all-matching", traceIds: new Set<string>() } }),

  clearSelection: () => set({ selection: { mode: "explicit", traceIds: new Set<string>() } }),

  setSelection: (selection) => set({ selection }),

  setSelectionViewKey: (key) => set({ selectionViewKey: key }),
});

/**
 * The export endpoint enforces this same cap, surfaced client-side so the
 * "Select all N matching" affordance can show "10,000 selected (max)".
 */
export const SELECT_ALL_MATCHING_CAP = 10_000;
