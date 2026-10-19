import { defineSlice } from "@langwatch/browser-host/global-store";
import {
  PRESENCE_PREFERENCES_SLICE,
  type PresencePreferencesState,
} from "@langwatch/presence-contract";

/** The reader's presence choices (ghost mode), in the global UI store (`presence:preferences`). */
export const usePresencePreferencesStore = defineSlice<PresencePreferencesState>({
  name: PRESENCE_PREFERENCES_SLICE,
  create: (set) => ({
    hidden: false,
    setHidden: (hidden) => set({ hidden }),
    toggleHidden: () => set((state) => ({ hidden: !state.hidden })),
  }),
  persist: {
    key: "langwatch:presence:preferences",
    partialize: ({ hidden }) => ({ hidden }),
  },
});
