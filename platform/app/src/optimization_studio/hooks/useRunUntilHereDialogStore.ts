import { create } from "zustand";

/**
 * Open state for the run-until-here dialog. The trigger lives on each
 * node's execution menu deep inside the React Flow canvas while the
 * dialog mounts once at the studio root, so the hop goes through a
 * tiny store instead of prop drilling. Kept separate from the dialog
 * component so the canvas nodes never import the dialog tree.
 */
export const useRunUntilHereDialogStore = create<{
  untilNodeId: string | undefined;
  open: (untilNodeId: string) => void;
  close: () => void;
}>((set) => ({
  untilNodeId: undefined,
  open: (untilNodeId) => set({ untilNodeId }),
  close: () => set({ untilNodeId: undefined }),
}));
