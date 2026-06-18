import { create } from "zustand";

interface SpanHoverState {
  /** SpanId currently hovered in the waterfall (either pane), if any. */
  hoveredSpanId: string | null;
  setHoveredSpanId: (spanId: string | null) => void;
}

/**
 * Hover highlight for the waterfall's synced tree/timeline panes.
 *
 * Lives in a store (not WaterfallView state) so that only the two rows
 * whose `hoveredSpanId === span.spanId` selector flips re-render on a
 * hover change — keeping hover at O(2) row renders instead of
 * re-rendering every virtualized row on both panes per mouse move.
 */
export const useSpanHoverStore = create<SpanHoverState>((set) => ({
  hoveredSpanId: null,
  setHoveredSpanId: (spanId) => set({ hoveredSpanId: spanId }),
}));
