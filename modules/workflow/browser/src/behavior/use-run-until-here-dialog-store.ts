import { create } from "zustand";

/** Shared open state between graph-node menus and the Studio dialog mount. */
export const useRunUntilHereDialogStore = create<{
  untilNodeId: string | undefined;
  open: (untilNodeId: string) => void;
  close: () => void;
}>((set) => ({
  untilNodeId: undefined,
  open: (untilNodeId) => set({ untilNodeId }),
  close: () => set({ untilNodeId: undefined }),
}));
