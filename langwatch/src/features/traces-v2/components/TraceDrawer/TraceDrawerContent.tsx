import { Box, CodeBlock, Flex, Spinner } from "@chakra-ui/react";
import { useRef } from "react";
import { useColorMode } from "~/components/ui/color-mode";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { PeerCursorOverlay } from "~/features/presence/components/PeerCursorOverlay";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { useCanViewConversation } from "../../context/TraceViewerContext";
import { useDrawerStore } from "../../stores/drawerStore";
import { BlurredContentGate } from "../BlurredContentGate";
import { ConversationContext } from "./ConversationContext";
import { ConversationView } from "./conversationView";
import { DrawerHeader } from "./drawerHeader";
import { useShikiAdapter } from "./markdownView/shikiAdapter";
import { PaneLayout } from "./panes/PaneLayout";
import { usePaneLayout } from "./panes/usePaneLayout";
import { ScenarioRoleProvider } from "./scenarioRoles";
import { TraceDrawerSkeleton } from "./TraceDrawerSkeleton";
import { TraceAccordions } from "./traceAccordions";
import { useTraceSwitchOverlay } from "./useTraceSwitchOverlay";

export interface TraceDrawerContentProps {
  traceId: string | undefined;
  trace: TraceHeader | null;
  spanTree: SpanTreeNode[];
  selectedSpan: SpanTreeNode | null;
  isLoading: boolean;
  isSpansLoading: boolean;
  onClose: () => void;
  /**
   * Public share view: no session and no drawer chrome. Suppresses the header's
   * mutating affordances and the presence subscriptions. See TraceViewerContext.
   */
  readOnly?: boolean;
}

/**
 * Everything inside the trace drawer that is actually *about the trace* —
 * header, panes, conversation, switch overlay. Deliberately free of drawer
 * chrome (Drawer.Root/Content/Body, resize rail, width, close), so the same
 * surface renders both in the drawer and full-page on `/share/<token>`.
 *
 * The host supplies the container: a `position: relative`, non-scrolling flex
 * column. Every section inside owns its own scroll viewport.
 */
export function TraceDrawerContent({
  traceId,
  trace,
  spanTree,
  selectedSpan,
  isLoading,
  isSpansLoading,
  onClose,
  readOnly = false,
}: TraceDrawerContentProps) {
  const { colorMode } = useColorMode();
  const canViewConversation = useCanViewConversation({
    conversationId: trace?.conversationId,
    isReadOnly: readOnly,
  });
  // One Shiki adapter for the whole surface. All `<RenderedMarkdown>`,
  // `<ShikiCodeBlock>`, and the JSON tokenizer consume this — without it,
  // each consumer spins up its own highlighter (theme + lang JSON +
  // Oniguruma engine), which got expensive once the chunked LLM panel
  // and conversation markdown views started mounting many siblings.
  const shikiAdapter = useShikiAdapter(colorMode);

  // Brief refreshing overlay when switching to a *different* trace — a
  // same-trace live update leaves this false so the surface doesn't flash.
  const showSwitchOverlay = useTraceSwitchOverlay({ traceId, isLoading });

  const viewMode = useDrawerStore((s) => s.viewMode);
  const expectedSpanCount = useDrawerStore((s) => s.expectedSpanCount);
  const ctxPaneState = useDrawerStore((s) => s.paneState.conversationContext);
  const togglePaneCollapsed = useDrawerStore((s) => s.togglePaneCollapsed);
  // Summary-tab span references (eval / event / exception rows) jump into
  // the Trace view and open the span. See
  // specs/traces-v2/span-reference-jump-to-trace.feature
  const openSpanInTrace = useDrawerStore((s) => s.openSpanInTrace);
  // Watch the actual rendered container so the layout decision reflects
  // whatever pixel width the surface has — not the abstract widthPx state.
  const paneContainerRef = useRef<HTMLDivElement>(null);
  const layout = usePaneLayout(paneContainerRef);

  return (
    <CodeBlock.AdapterProvider value={shikiAdapter}>
      {isLoading || !trace ? (
        <TraceDrawerSkeleton
          onClose={onClose}
          expectedSpanCount={expectedSpanCount}
        />
      ) : (
        <>
          <Box
            flexShrink={0}
            // Translucent fill + backdrop blur so the page behind reads
            // through. The lower pane container keeps its solid `bg.surface`
            // white, so only the header strip is translucent.
            bg="bg.panel/70"
            backdropFilter="blur(20px) saturate(150%)"
          >
            <IsolatedErrorBoundary
              scope="Couldn't render this trace's header"
              resetKeys={[trace.traceId]}
            >
              <DrawerHeader
                trace={trace}
                onClose={onClose}
                readOnly={readOnly}
              />
            </IsolatedErrorBoundary>
          </Box>
          <Box borderBottomWidth="1px" borderColor="border" />
          {/*
            Peer cursors render across the entire body. The `anchor` keys the
            shared coordinate space; everyone looking at the same trace shares
            one (0..1, 0..1) plane regardless of view mode. Disabled for share
            viewers: presence opens an SSE subscription and broadcasts cursor
            mutations, both of which need a session.
          */}
          <PeerCursorOverlay
            anchor={`trace:${trace.traceId}:drawer`}
            enabled={!readOnly}
            containerRef={paneContainerRef}
          >
            {/*
              `height="100%"` (not `flex={1}`) because PeerCursorOverlay wraps
              its children in a `position: relative` Box that isn't a flex
              container, so `flex: 1` is inert here.
            */}
            <Flex
              ref={paneContainerRef}
              height="100%"
              minHeight={0}
              minWidth={0}
              direction="column"
              position="relative"
              bg={{ base: "bg.surface", _dark: "bg.panel" }}
            >
              <ScenarioRoleProvider
                isScenario={
                  !!(trace.scenarioRunId ?? trace.attributes["scenario.run_id"])
                }
              >
                {viewMode === "conversation" && canViewConversation ? (
                  <IsolatedErrorBoundary
                    scope="Couldn't render conversation view"
                    resetKeys={[trace.conversationId, trace.traceId]}
                  >
                    <Box flex={1} minHeight={0} overflow="auto">
                      <ConversationView
                        conversationId={trace.conversationId!}
                        currentTraceId={trace.traceId}
                      />
                    </Box>
                  </IsolatedErrorBoundary>
                ) : viewMode === "summary" ? (
                  // Summary mode shows the same conversation-context strip the
                  // Trace view renders (via PaneLayout) so multi-turn context
                  // isn't lost when reading the summary. Same store-backed
                  // collapse state, so collapsing it in one view collapses it
                  // in both.
                  <IsolatedErrorBoundary
                    scope="Couldn't render trace summary"
                    resetKeys={[trace.traceId]}
                  >
                    {trace.conversationId && (
                      <IsolatedErrorBoundary
                        scope="Couldn't render conversation context"
                        resetKeys={[trace.conversationId, trace.traceId]}
                      >
                        {/* ConversationContext's root is height=100% (sized by
                            PaneLayout's resizable Panel in Trace view). Here it
                            sits in a plain flex column, where 100% would claim
                            the whole surface and crush the accordions below —
                            the wrapper gives it a natural-height, capped,
                            scrollable slot instead. */}
                        <Box flexShrink={0} maxHeight="48%" overflow="auto">
                          <ConversationContext
                            conversationId={trace.conversationId}
                            traceId={trace.traceId}
                            collapsed={ctxPaneState.collapsed}
                            onToggleCollapsed={() =>
                              togglePaneCollapsed("conversationContext")
                            }
                          />
                        </Box>
                      </IsolatedErrorBoundary>
                    )}
                    <Box flex={1} minHeight={0} overflow="auto">
                      <TraceAccordions
                        trace={trace}
                        spans={spanTree}
                        selectedSpan={null}
                        activeTab="summary"
                        onSelectSpan={openSpanInTrace}
                      />
                    </Box>
                  </IsolatedErrorBoundary>
                ) : (
                  <PaneLayout
                    trace={trace}
                    spans={spanTree}
                    selectedSpan={selectedSpan}
                    isSpansLoading={isSpansLoading}
                    layout={layout}
                  />
                )}
              </ScenarioRoleProvider>
              {trace.redactedByVisibilityWindow ? <BlurredContentGate /> : null}
            </Flex>
          </PeerCursorOverlay>
        </>
      )}
      {/* Trace-switch refresh overlay: a translucent blurred scrim with a
          spinner that covers the whole body while moving from one trace to
          another. Only fires on a genuine A→B switch (never on a same-trace
          live update). `pointerEvents="none"` so it never traps clicks. */}
      {showSwitchOverlay && (
        <Box
          position="absolute"
          inset={0}
          zIndex={3}
          display="flex"
          alignItems="center"
          justifyContent="center"
          borderRadius="lg"
          bg="bg.panel/60"
          backdropFilter="blur(8px) saturate(140%)"
          pointerEvents="none"
          css={{
            animation: "tracesV2DrawerSwitchFade 140ms ease-out",
            "@keyframes tracesV2DrawerSwitchFade": {
              from: { opacity: 0 },
              to: { opacity: 1 },
            },
          }}
        >
          <Spinner size="lg" color="blue.solid" borderWidth="2px" />
        </Box>
      )}
    </CodeBlock.AdapterProvider>
  );
}
