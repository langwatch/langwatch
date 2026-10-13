import { defineSlice } from "@langwatch/browser-host/global-store";

/** Shared open state between graph-node menus and the Studio dialog mount. */
export const useRunUntilHereDialogStore = defineSlice<{
  untilNodeId: string | undefined;
  open: (untilNodeId: string) => void;
  close: () => void;
}>({
  name: "workflow:run-until-here-dialog",
  create: (set) => ({
    untilNodeId: undefined,
    open: (untilNodeId) => set({ untilNodeId }),
    close: () => set({ untilNodeId: undefined }),
  }),
});
