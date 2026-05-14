import { create } from "zustand";

interface SectionTrackerState {
  /**
   * Visibility ratio (0–1) for each registered section id. We pick the
   * section with the highest ratio as the "currently focused" section so
   * peers see one stable hint per user, not a list of partial overlaps.
   */
  visibility: Map<string, number>;

  setVisibility: (id: string, ratio: number) => void;
  unregister: (id: string) => void;
  reset: () => void;
}

export const useSectionTrackerStore = create<SectionTrackerState>((set) => ({
  visibility: new Map(),

  setVisibility: (id, ratio) =>
    set((state) => {
      const next = new Map(state.visibility);
      if (ratio <= 0) {
        next.delete(id);
      } else {
        next.set(id, ratio);
      }
      return { visibility: next };
    }),

  unregister: (id) =>
    set((state) => {
      if (!state.visibility.has(id)) return state;
      const next = new Map(state.visibility);
      next.delete(id);
      return { visibility: next };
    }),

  reset: () => set({ visibility: new Map() }),
}));

/** The section id with the highest current visibility, or null when nothing
 *  is in view. Returns null if nothing exceeds the noise floor (10%). */
export function selectMostVisibleSection(
  state: SectionTrackerState,
): string | null {
  let bestId: string | null = null;
  let bestRatio = 0.1;
  for (const [id, ratio] of state.visibility) {
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestId = id;
    }
  }
  return bestId;
}
