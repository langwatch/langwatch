import { defineSlice } from "@langwatch/browser-host/global-store";

interface SpanHoverState {
  /** SpanId currently hovered in the waterfall (either pane), if any. */
  hoveredSpanId: string | null;
  setHoveredSpanId: (spanId: string | null) => void;
}

/**
 * Hover highlight for the waterfall's synced tree/timeline panes.
 */
export const useSpanHoverStore = defineSlice<SpanHoverState>({
  name: "trace:span-hover",
  create: (set) => ({
    hoveredSpanId: null,
    setHoveredSpanId: (spanId) => set({ hoveredSpanId: spanId }),
  }),
});
