import { create } from "zustand";

interface PendingFocus {
  /** Trace this focus request applies to — observers ignore other traces. */
  traceId: string;
  /** Section id to expand + scroll to (matches the `value` of a `<Section>`). */
  section: string;
  /**
   * Monotonic counter so re-clicking the same chip re-triggers the effect
   * even when traceId + section are identical to the prior request.
   */
  nonce: number;
}

interface FocusSectionState {
  pending: PendingFocus | null;
  request: (params: { traceId: string; section: string }) => void;
  clear: () => void;
}

/**
 * One-shot signal store for "expand + scroll the trace summary section
 * with id X". Used by header chips (eval chip, error chip, …) to deep-
 * link operators from a compact metadata pill straight to the relevant
 * accordion section without prop-drilling refs across the drawer.
 *
 * `TraceSummaryAccordions` observes `pending`; when it matches the
 * mounted trace, it adds the section to its open list and scrolls the
 * section into view, then calls `clear()`.
 */
export const useFocusSectionStore = create<FocusSectionState>((set, get) => ({
  pending: null,
  request: ({ traceId, section }) => {
    const nonce = (get().pending?.nonce ?? 0) + 1;
    set({ pending: { traceId, section, nonce } });
  },
  clear: () => set({ pending: null }),
}));
