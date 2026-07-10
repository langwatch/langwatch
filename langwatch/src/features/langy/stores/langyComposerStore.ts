import { create } from "zustand";

/**
 * A removable page-context chip that rides INSIDE the composer surface (e.g.
 * "Experiment: my-slug", "Trace: abc123"). Page context is derived by the
 * panel from the current route / LangyContext; this store only tracks which
 * chips the user has dismissed, so a dismissed chip stays gone until the
 * underlying context changes (a new id re-surfaces it).
 */
export interface LangyContextChip {
  /** Stable id, e.g. `experiment:my-slug`. Dismissal is keyed on this. */
  id: string;
  kind: "experiment" | "trace";
  label: string;
}

interface LangyComposerState {
  dismissedChipIds: Set<string>;
  dismissChip: (id: string) => void;
  /** Clear dismissals — used on "new chat" so chips return for the fresh turn. */
  resetDismissed: () => void;
}

export const useLangyComposerStore = create<LangyComposerState>((set) => ({
  dismissedChipIds: new Set<string>(),
  dismissChip: (id) =>
    set((state) => {
      const next = new Set(state.dismissedChipIds);
      next.add(id);
      return { dismissedChipIds: next };
    }),
  resetDismissed: () => set({ dismissedChipIds: new Set<string>() }),
}));

/** Filter a candidate chip list down to the ones the user hasn't dismissed. */
export function selectVisibleChips(
  candidates: LangyContextChip[],
  dismissed: Set<string>,
): LangyContextChip[] {
  return candidates.filter((chip) => !dismissed.has(chip.id));
}
