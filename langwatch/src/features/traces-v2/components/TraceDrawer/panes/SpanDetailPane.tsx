import { Box } from "@chakra-ui/react";
import { memo } from "react";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { useDrawerStore } from "../../../stores/drawerStore";
import { SpanTabBar } from "../SpanTabBar";
import { TraceAccordions } from "../traceAccordions";

interface SpanDetailPaneProps {
  trace: TraceHeader;
  spans: SpanTreeNode[];
  selectedSpan: SpanTreeNode | null;
  /**
   * Whether the panel sits below ("vertical") or to the right
   * ("horizontal") of the visualization. Drives where the SpanTabBar's
   * collapse toggle sits — on the right edge of the tab row when
   * stacked below, on the left when side-by-side.
   */
  layout: "vertical" | "horizontal";
  /**
   * Forwarded to TraceAccordions so it can render a span-shaped
   * skeleton while the spanTree query is in flight. Without this we'd
   * fall back to the trace summary on every cold open of the trace
   * pane — see the comment in TraceAccordions for the full story.
   */
  isSpansLoading?: boolean;
}

/**
 * Right-side (or bottom-stacked) panel — only mounts when a span is
 * selected (the gate lives in `PaneLayout`). The SpanTabBar carries
 * span-scope tabs (selected + pinned); the body always renders the
 * per-span accordion stack (TraceAccordions activeTab="span"): input/
 * output, attributes, evals, events, exceptions.
 *
 * An earlier iteration of this pane auto-routed LLM spans to a
 * dedicated `LlmPanel` (the old "LLM-Optimized" tab body). User
 * feedback: clicking an LLM span should still show the regular span
 * detail, not a different layout — surprise mode-swaps based on span
 * kind broke the user's mental model. The LlmPanel surface is still
 * available via its keyboard shortcut history, but it's no longer the
 * default click destination.
 *
 * The collapse toggle on the SpanTabBar is preserved as an escape
 * hatch — when collapsed the SpanTabBar stays visible (it's the only
 * thing rendered) so the user can re-expand or pick a different
 * pinned span.
 */
export const SpanDetailPane = memo(function SpanDetailPane({
  trace,
  spans,
  selectedSpan,
  layout,
  isSpansLoading,
}: SpanDetailPaneProps) {
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);
  const selectSpan = useDrawerStore((s) => s.selectSpan);
  const collapsed = useDrawerStore((s) => s.paneState.spanDetail.collapsed);

  return (
    <Box
      display="flex"
      flexDirection="column"
      height="100%"
      width="100%"
      minHeight={0}
      minWidth={0}
      // `overflow: hidden` on the pane root makes this a proper
      // scroll-container ancestor. Without it, the inner flex:1 +
      // overflow:auto child could end up taller than its parent in
      // contexts where the Panel from react-resizable-panels doesn't
      // strictly clamp child height — and the scrollbar then attached
      // to an ancestor instead of the accordion area, which the
      // operator read as "scroll doesn't work". Combined with the
      // explicit `height: 100%` style below, this guarantees the
      // accordion list lives inside a fixed-height box and its own
      // overflow:auto engages.
      overflow="hidden"
      style={{ height: "100%" }}
      bg={{ base: "bg.surface", _dark: "bg.panel" }}
    >
      <Box flexShrink={0} bg={{ base: "bg.surface", _dark: "bg.panel" }}>
        <IsolatedErrorBoundary
          scope="Couldn't render span tabs"
          resetKeys={[trace.traceId]}
        >
          <SpanTabBar
            spanTree={spans}
            collapsePosition={layout === "horizontal" ? "leading" : "trailing"}
          />
        </IsolatedErrorBoundary>
      </Box>
      {!collapsed && (
        <Box
          flex={1}
          minHeight={0}
          minWidth={0}
          overflow="auto"
          // Explicit `height: 100%` on the scroll body so it actually
          // owns the available pane height even if a flex:1 collapse
          // happens upstream — pairs with the `overflow: hidden` on
          // the outer Box.
          style={{ overflowAnchor: "none", height: "100%" }}
        >
          <IsolatedErrorBoundary
            scope="Couldn't render the span detail"
            resetKeys={[trace.traceId, selectedSpanId]}
          >
            <TraceAccordions
              trace={trace}
              spans={spans}
              selectedSpan={selectedSpan}
              activeTab="span"
              selectedSpanId={selectedSpanId}
              isSpansLoading={isSpansLoading}
              onSelectSpan={selectSpan}
            />
          </IsolatedErrorBoundary>
        </Box>
      )}
    </Box>
  );
});
