import { defineSlice } from "@langwatch/browser-host/global-store";
import {
  PRESENCE_SECTION_TRACKER_SLICE,
  type SectionTrackerState,
} from "@langwatch/presence-contract";

export { pickMostVisibleSection } from "@langwatch/presence-contract";

/** Which section the reader is looking at, in the global UI store (`presence:section-tracker`). */
export const useSectionTrackerStore = defineSlice<SectionTrackerState>({
  name: PRESENCE_SECTION_TRACKER_SLICE,
  create: (set) => ({
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
  }),
});
