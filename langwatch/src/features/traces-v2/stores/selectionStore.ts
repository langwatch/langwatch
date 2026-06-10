import { create } from "zustand";

/**
 * Selection state for bulk actions on the trace table.
 *
 * Two modes:
 * - "explicit": `traceIds` is the authoritative set the user picked
 * - "all-matching": all traces matching the current filter (capped server-side
 *   at 10,000 to match the export limit). `traceIds` is empty in this mode and
 *   bulk actions reuse the active filters/time range instead of an ID list.
 */
export type SelectionMode = "explicit" | "all-matching";

interface SelectionState {
  mode: SelectionMode;
  traceIds: Set<string>;

  toggle: (traceId: string) => void;
  setMany: (traceIds: string[], checked: boolean) => void;
  enableAllMatching: () => void;
  clear: () => void;

  has: (traceId: string) => boolean;
  size: () => number;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  mode: "explicit",
  traceIds: new Set<string>(),

  toggle: (traceId) =>
    set((state) => {
      const next = new Set(state.traceIds);
      if (state.mode === "all-matching") {
        // Toggling a row drops out of all-matching mode and starts an
        // explicit set seeded with whatever the user is doing now.
        next.add(traceId);
        return { mode: "explicit", traceIds: next };
      }
      if (next.has(traceId)) next.delete(traceId);
      else next.add(traceId);
      return { traceIds: next };
    }),

  setMany: (traceIds, checked) =>
    set((state) => {
      const next =
        state.mode === "all-matching"
          ? new Set<string>()
          : new Set(state.traceIds);
      for (const id of traceIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return { mode: "explicit", traceIds: next };
    }),

  enableAllMatching: () =>
    set({ mode: "all-matching", traceIds: new Set<string>() }),

  clear: () => set({ mode: "explicit", traceIds: new Set<string>() }),

  has: (traceId) => get().traceIds.has(traceId),
  size: () => get().traceIds.size,
}));

/**
 * The export endpoint enforces this same cap. We surface it client-side so the
 * "Select all N matching" affordance can show "10,000 selected (max)".
 */
export const SELECT_ALL_MATCHING_CAP = 10_000;
