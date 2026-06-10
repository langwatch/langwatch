import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface PresencePreferencesState {
  /**
   * When true, the local user opts out of broadcasting their presence and
   * cursor to peers. They can still *see* peer presence — this only gates
   * the write side ("ghost mode").
   */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  toggleHidden: () => void;
}

export const usePresencePreferencesStore = create<PresencePreferencesState>()(
  persist(
    (set) => ({
      hidden: false,
      setHidden: (hidden) => set({ hidden }),
      toggleHidden: () => set((state) => ({ hidden: !state.hidden })),
    }),
    {
      name: "langwatch:presence:preferences",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
