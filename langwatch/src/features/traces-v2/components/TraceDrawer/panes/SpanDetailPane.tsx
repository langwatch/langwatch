import { Box } from "@chakra-ui/react";
import { memo } from "react";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { useDrawerStore } from "../../../stores/drawerStore";
import { useTraceResources } from "../../../hooks/useTraceResources";
import { parseTracePromptIds } from "../../../utils/promptAttributes";
import { LlmPanel } from "../LlmPanel";
import { PromptsPanel } from "../PromptsPanel";
import { ScopeChip } from "../ScopeChip";
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
}

/**
 * Right-side (or bottom-stacked) panel: SpanTabBar acts as the panel's
 * own header chrome (with a collapse toggle at its leftmost edge), and
 * the active detail panel (`Summary` / `LlmPanel` / `PromptsPanel` /
 * span-specific accordion) renders below it inside its own scroll
 * viewport so the drawer body itself never scrolls.
 *
 * When the user collapses the panel through the SpanTabBar's chevron,
 * the SpanTabBar itself remains visible (it's now the only thing the
 * collapsed Panel renders) and the body area is hidden.
 */
export const SpanDetailPane = memo(function SpanDetailPane({
  trace,
  spans,
  selectedSpan,
  layout,
}: SpanDetailPaneProps) {
  const activeTab = useDrawerStore((s) => s.activeTab);
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);
  const selectSpan = useDrawerStore((s) => s.selectSpan);
  const collapsed = useDrawerStore((s) => s.paneState.spanDetail.collapsed);
  const resources = useTraceResources(trace.traceId);

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
        flexShrink={0}
        bg={{ base: "bg.surface", _dark: "bg.panel" }}
      >
        <IsolatedErrorBoundary
          scope="Couldn't render span tabs"
          resetKeys={[trace.traceId]}
        >
          <SpanTabBar
            spanTree={spans}
            promptCount={parseTracePromptIds(trace.attributes).length}
            rightSlot={<ScopeChip scope={resources.scope} />}
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
      )}
    </Box>
  );
});

