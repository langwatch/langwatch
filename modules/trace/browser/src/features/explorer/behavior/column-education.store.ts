import { defineSlice } from "@langwatch/browser-host/global-store";

/**
 * Tracks whether the column-reorder education dialog has been shown (or explicitly
 * dismissed) so it only fires once per reader.
 */
interface ColumnEducationState {
  isOpen: boolean;
  hasDismissed: boolean;
  open: () => void;
  dismiss: (forever?: boolean) => void;
}

export const useColumnEducationStore = defineSlice<ColumnEducationState>({
  name: "trace:column-education",
  create: (set) => ({
    isOpen: false,
    hasDismissed: false,
    open: () => set({ isOpen: true }),
    dismiss: (forever) => set(forever ? { isOpen: false, hasDismissed: true } : { isOpen: false }),
  }),
  persist: { partialize: ({ hasDismissed }) => ({ hasDismissed }) },
});

/**
 * Pixel movement threshold past which we consider a mousedown on a column header to be
 * a *drag attempt*.
 */
export const COLUMN_DRAG_THRESHOLD_PX = 6;
