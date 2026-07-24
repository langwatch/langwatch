import { create } from "zustand";

/**
 * Tracks whether the column-reorder education dialog has been shown
 * (or explicitly dismissed) so it only fires once per browser. The
 * dialog appears the first time the operator attempts to drag a
 * column header in the v2 trace table; the v2 table doesn't support
 * native drag-reorder yet, so without education the drag attempt
 * silently does nothing and the user concludes "the columns just
 * aren't reorderable" — wrong. The dialog teaches that columns are
 * managed from the Columns dropdown / Configure popover, with a small
 * preview of where that lives.
 */
interface ColumnEducationState {
  isOpen: boolean;
  hasDismissed: boolean;
  open: () => void;
  dismiss: (forever?: boolean) => void;
}

const STORAGE_KEY = "langwatch:traces-v2:columnEducationDismissed";

function loadDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismissed(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
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
 * Pixel movement threshold past which we consider a mousedown on a
 * column header to be a *drag attempt*. Small enough that a casual
 * intent reads as "I want to move this," large enough that a sloppy
 * click on a sortable header doesn't trigger the dialog every time.
 */
export const COLUMN_DRAG_THRESHOLD_PX = 6;
