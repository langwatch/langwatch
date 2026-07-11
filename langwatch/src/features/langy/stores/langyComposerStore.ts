import { create } from "zustand";

/**
 * A removable page-context chip that rides INSIDE the composer surface (e.g.
 * "Experiment: my-slug", "Trace: abc123", "Project: web-app"). Page context is
 * derived by the panel from the current route / LangyContext (see
 * `useLangyPageContext`); this store only tracks which chips the user has
 * dismissed, so a dismissed chip stays gone until the underlying context
 * changes (a new id re-surfaces it) or the user adds it back.
 */
export interface LangyContextChip {
  /** Stable id, e.g. `experiment:my-slug`. Dismissal is keyed on this. */
  id: string;
  kind:
    | "project"
    | "experiment"
    | "trace"
    | "prompt"
    | "dataset"
    | "dashboard"
    | "scenario";
  label: string;
  /**
   * The resource ref (id / slug) this chip stands for, forwarded to the agent
   * as turn context. Absent for the project chip (the project is implicit).
   */
  ref?: string;
}

interface LangyComposerState {
  dismissedChipIds: Set<string>;
  dismissChip: (id: string) => void;
  /** Undo a dismissal — used by the composer's "+ context" add control. */
  restoreChip: (id: string) => void;
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
  restoreChip: (id) =>
    set((state) => {
      if (!state.dismissedChipIds.has(id)) return state;
      const next = new Set(state.dismissedChipIds);
      next.delete(id);
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

/** The dismissed subset of a candidate list — the "+ context" add menu. */
export function selectDismissedChips(
  candidates: LangyContextChip[],
  dismissed: Set<string>,
): LangyContextChip[] {
  return candidates.filter((chip) => dismissed.has(chip.id));
}
