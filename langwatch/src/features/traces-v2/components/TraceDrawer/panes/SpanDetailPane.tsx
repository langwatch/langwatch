import { Box } from "@chakra-ui/react";
import { memo } from "react";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { useDrawerStore } from "../../../stores/drawerStore";
import { parseTracePromptIds } from "../../../utils/promptAttributes";
import { LlmPanel } from "../LlmPanel";
import { PromptsPanel } from "../PromptsPanel";
import { SpanTabBar } from "../SpanTabBar";
import { TraceAccordions } from "../traceAccordions";

interface SpanDetailPaneProps {
  trace: TraceHeader;
  spans: SpanTreeNode[];
  selectedSpan: SpanTreeNode | null;
}

/**
 * Right-side (or bottom-stacked) pane: the active span / summary detail
 * panel preceded by the SpanTabBar. Owns its own vertical scroll so the
 * drawer body never scrolls.
 *
 * The pane fills its parent panel: in horizontal layout it occupies the
 * right column of the Visualization | Detail split; in vertical layout
 * it occupies the bottom row. The SpanTabBar stays sticky to the top of
 * the pane's own scroll viewport so it remains visible as the user
 * scrolls through long detail panels.
 */
export const SpanDetailPane = memo(function SpanDetailPane({
  trace,
  spans,
  selectedSpan,
}: SpanDetailPaneProps) {
  const activeTab = useDrawerStore((s) => s.activeTab);
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);
  const selectSpan = useDrawerStore((s) => s.selectSpan);

  return (
    <Box
      display="flex"
      flexDirection="column"
      height="100%"
      width="100%"
      minHeight={0}
      minWidth={0}
      bg={{ base: "bg.surface", _dark: "bg.panel" }}
    >
      <Box
        position="sticky"
        top={0}
        zIndex={2}
        bg={{ base: "bg.surface", _dark: "bg.panel" }}
        flexShrink={0}
      >
        <IsolatedErrorBoundary
          scope="Couldn't render span tabs"
          resetKeys={[trace.traceId]}
        >
          <SpanTabBar
            spanTree={spans}
            promptCount={parseTracePromptIds(trace.attributes).length}
          />
        </IsolatedErrorBoundary>
      </Box>
      <Box
        flex={1}
        minHeight={0}
        minWidth={0}
        overflow="auto"
        style={{ overflowAnchor: "none" }}
      >
        <IsolatedErrorBoundary
          scope={`Couldn't render the ${activeTab} tab`}
          resetKeys={[trace.traceId, activeTab, selectedSpanId]}
        >
          {activeTab === "llm" ? (
            <LlmPanel trace={trace} spans={spans} />
          ) : activeTab === "prompts" ? (
            <PromptsPanel
              trace={trace}
              spans={spans}
              onSelectSpan={selectSpan}
            />
          ) : (
            <TraceAccordions
              trace={trace}
              spans={spans}
              selectedSpan={selectedSpan}
              activeTab={activeTab}
              onSelectSpan={selectSpan}
            />
          )}
        </IsolatedErrorBoundary>
      </Box>
    </Box>
  );
});
