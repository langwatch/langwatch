import { create } from "zustand";

/**
 * Tracks whether the column-reorder education dialog has been shown (or explicitly
 * dismissed) so it only fires once per browser.
 */
interface ColumnEducationState {
  isOpen: boolean;
  hasDismissed: boolean;
  open: () => void;
  dismiss: (forever?: boolean) => void;
}

const STORAGE_KEY = "langwatch:traces-v2:columnEducationDismissed";

function loadDismissed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismissed(value: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (value) {
      localStorage.setItem(STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore storage write failures
  }
}

export const useColumnEducationStore = create<ColumnEducationState>((set) => ({
  isOpen: false,
  hasDismissed: loadDismissed(),
  open: () => set({ isOpen: true }),
  dismiss: (forever) => {
    set({ isOpen: false });
    if (forever) {
      set({ hasDismissed: true });
      persistDismissed(true);
    }
  },
}));

/**
 * Pixel movement threshold past which we consider a mousedown on a column header to be
 * a *drag attempt*.
 */
export const COLUMN_DRAG_THRESHOLD_PX = 6;
