import { Box } from "@chakra-ui/react";
import { memo } from "react";
import { IsolatedErrorBoundary } from "../../../isolated-error-boundary";
import type { SpanTreeNode, TraceHeader } from "@langwatch/trace-contract";
import { useDrawerStore } from "../../../../../index";
import { SpanTabBar } from "../span-tab-bar";
import { TraceAccordions } from "../trace-accordions";

interface SpanDetailPaneProps {
  trace: TraceHeader;
  spans: SpanTreeNode[];
  selectedSpan: SpanTreeNode | null;
  /**
   * Whether the panel sits below ("vertical") or to the right ("horizontal") of the
   * visualization. Drives where the SpanTabBar's collapse toggle sits — on the right
   * edge of the tab row when stacked below, on the left when side-by-side.
   */
  layout: "vertical" | "horizontal";
  /**
   * Forwarded to TraceAccordions so it can render a span-shaped skeleton while the
   * spanTree query is in flight.
   */
  isSpansLoading?: boolean;
}

/**
 * Right-side (or bottom-stacked) panel — only mounts when a span is selected (the gate
 * lives in `PaneLayout`).
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
      // `overflow: hidden` on the pane root makes this a proper scroll-container
      // ancestor.
      overflow="hidden"
      style={{ height: "100%" }}
      bg={{ base: "bg.surface", _dark: "bg.panel" }}
    >
      <Box flexShrink={0} bg={{ base: "bg.surface", _dark: "bg.panel" }}>
        <IsolatedErrorBoundary scope="Couldn't render span tabs" resetKeys={[trace.traceId]}>
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
