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
}: SpanDetailPaneProps) {
  const activeTab = useDrawerStore((s) => s.activeTab);
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
            rightSlot={
              trace.attributes["scope.name"] || trace.attributes["service.name"]
                ? (
                  <InstrumentationScopeChip
                    scopeName={
                      (trace.attributes["scope.name"] as string | undefined) ??
                      (trace.attributes["service.name"] as string | undefined) ??
                      null
                    }
                    scopeVersion={
                      trace.attributes["scope.version"] as string | undefined
                    }
                  />
                )
                : null
            }
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

/**
 * Right-aligned chip in the SpanTabBar surfacing the instrumentation
 * scope. The scope tells the operator what library or runtime emitted
 * the spans — useful for triage but it's secondary metadata, so
 * pinning it to the tab row keeps it close to the panel without
 * stealing its own row.
 */
function InstrumentationScopeChip({
  scopeName,
  scopeVersion,
}: {
  scopeName: string | null;
  scopeVersion?: string;
}) {
  if (!scopeName) return null;
  const label = scopeVersion ? `${scopeName} · ${scopeVersion}` : scopeName;
  return (
    <Box
      as="span"
      fontSize="xs"
      color="fg.muted"
      fontFamily="mono"
      truncate
      maxWidth="220px"
      title={label}
    >
      {label}
    </Box>
  );
}
