import { Box, CodeBlock, VStack } from "@chakra-ui/react";
import { motion } from "motion/react";
import { useEffect } from "react";
import { useColorMode } from "~/components/ui/color-mode";
import { Drawer } from "~/components/ui/drawer";
import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawerStore } from "../../stores/drawerStore";
import { parseTracePromptIds } from "../../utils/promptAttributes";
import { BelowFoldIndicator } from "./BelowFoldIndicator";
import { ConversationContext } from "./ConversationContext";
import { ConversationView } from "./conversationView";
import { DrawerHeader } from "./drawerHeader";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
import { LlmPanel } from "./LlmPanel";
import { useShikiAdapter } from "./markdownView/shikiAdapter";
import { PromptsPanel } from "./PromptsPanel";
import { SpanTabBar } from "./SpanTabBar";
import { ScenarioRoleProvider } from "./scenarioRoles";
import { TraceDrawerEmptyState } from "./TraceDrawerEmptyState";
import { TraceDrawerSkeleton } from "./TraceDrawerSkeleton";
import { TraceAccordions } from "./traceAccordions";
import { useTraceDrawerScaffold } from "./useTraceDrawerScaffold";
import { VizPlaceholder } from "./VizPlaceholder";

export interface TraceV2DrawerShellProps {
  open?: boolean;
  onClose?: () => void;
  traceId?: string;
  span?: string;
  mode?: string;
  viz?: string;
  /**
   * Approximate trace timestamp (ms since epoch) — read by `useTraceHeader`
   * as a partition-pruning hint when refetching the heavy summary fields.
   * Optional; the bare `traceId` query path still works on cache miss.
   */
  t?: string;
}

export function TraceV2DrawerShell(_props: TraceV2DrawerShellProps) {
  const { colorMode } = useColorMode();
  // One Shiki adapter for the whole drawer. All `<RenderedMarkdown>`,
  // `<ShikiCodeBlock>`, and the JSON tokenizer consume this — without it,
  // each consumer span up its own highlighter (theme + lang JSON +
  // Oniguruma engine), which got expensive once the chunked LLM panel
  // and conversation markdown views started mounting many siblings.
  const shikiAdapter = useShikiAdapter(colorMode);

  const {
    traceId,
    trace,
    spanTree,
    selectedSpan,
    isLoading,
    headerQuery,
    spanTreeQuery,
    canGoBack,
    goBackInTraceHistory,
    handleClose,
    drawerContentRef,
    drawerBodyRef,
    scrollContentRef,
  } = useTraceDrawerScaffold();

  const viewMode = useDrawerStore((s) => s.viewMode);
  const vizTab = useDrawerStore((s) => s.vizTab);
  const activeTab = useDrawerStore((s) => s.activeTab);
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);
  const isMaximized = useDrawerStore((s) => s.isMaximized);
  const shortcutsOpen = useDrawerStore((s) => s.shortcutsOpen);
  const pinned = useDrawerStore((s) => s.pinned);

  const setVizTab = useDrawerStore((s) => s.setVizTab);
  const selectSpan = useDrawerStore((s) => s.selectSpan);
  const clearSpan = useDrawerStore((s) => s.clearSpan);
  const toggleMaximized = useDrawerStore((s) => s.toggleMaximized);
  const setShortcutsOpen = useDrawerStore((s) => s.setShortcutsOpen);

  // Reset every drawer scroll container when the user crosses a layout
  // boundary — switching the top-level mode (Trace ↔ Conversation) or the
  // active span/summary tab. Without this, the browser carries the previous
  // scrollTop into a totally different DOM (conversation has no viz chrome,
  // summary has the input element), landing the operator halfway down or
  // jumping mid-element. `overflowAnchor: "none"` only stops *automatic*
  // anchoring; it doesn't actively reset to 0. We do that here.
  useEffect(() => {
    drawerBodyRef.current?.scrollTo({ top: 0 });
    scrollContentRef.current?.scrollTo({ top: 0 });
  }, [viewMode, activeTab, drawerBodyRef, scrollContentRef]);

  // Error state: trace not found, network failure, or no selection. The
  // dedicated empty-state component differentiates 404 vs load-failed and
  // surfaces the trace ID + retry path.
  if (!isLoading && !trace) {
    return (
      <Drawer.Root
        open={true}
        placement="end"
        size="lg"
        onOpenChange={() => handleClose()}
      >
        <Drawer.Content>
          <Drawer.Body padding={0}>
            <TraceDrawerEmptyState
              error={headerQuery.error}
              traceId={traceId}
              onClose={handleClose}
              onRetry={() => void headerQuery.refetch()}
              canGoBack={canGoBack}
              onGoBack={goBackInTraceHistory}
            />
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    );
  }

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size={isMaximized ? "full" : "lg"}
      // When unpinned, the drawer behaves as a standard modal — clicking
      // outside or pressing Esc dismisses it. When pinned (default), it
      // stays put so the operator can interact with the underlying page;
      // dismissal is via the X button, Esc, or the explicit double-click
      // gesture handled in the scaffold.
      modal={!pinned}
      closeOnInteractOutside={!pinned}
      onOpenChange={() => handleClose()}
    >
      <CodeBlock.AdapterProvider value={shikiAdapter}>
        <Drawer.Content
          ref={drawerContentRef}
          paddingX={0}
          // Maximized state used to expand to a full 100vw, leaving no gap on
          // the left to click outside / peek at what's underneath. Capping at
          // `calc(100vw - 80px)` keeps the page edge visible and clickable
          // while still giving the drawer effectively all the horizontal
          // room it needs for waterfall views.
          maxWidth={isMaximized ? "calc(100vw - 10px)" : "45%"}
          transition="max-width 0.2s ease"
          // Anchor for the empty-state onboarding tour: a global
          // CSS rule keyed off `body[data-traces-tour-stage]`
          // applies a soft blue glow to this element during
          // `drawerOverview` so the user knows where the tour copy
          // is pointing. No-op outside the onboarding journey.
          data-tour-target="drawer"
        >
          <ResizeEdgeGrip
            onDoubleClick={toggleMaximized}
            isMaximized={isMaximized}
          />
          <Drawer.Body
            ref={drawerBodyRef}
            paddingY={0}
            paddingX={0}
            overflowY="auto"
            // The drawer body is also a scroll container alongside the inner
            // panel scroller. Without this, the browser's scroll-anchoring
            // grabs whatever element it finds when the panel's chrome (viz +
            // conversation context) is conditionally hidden on the LLM tab,
            // and slams scrollTop to the bottom of the new layout.
            style={{ overflowAnchor: "none" }}
          >
            <VStack align="stretch" gap={0} height="full">
              {isLoading || !trace ? (
                <TraceDrawerSkeleton onClose={handleClose} />
              ) : (
                <>
                  <Box onDoubleClick={toggleMaximized}>
                    <IsolatedErrorBoundary
                      scope="Couldn't render this trace's header"
                      resetKeys={[trace.traceId]}
                    >
                      <DrawerHeader trace={trace} onClose={handleClose} />
                    </IsolatedErrorBoundary>
                  </Box>
                  <Box borderBottomWidth="1px" borderColor="border" />
                </>
              )}

              {isLoading ? null : trace ? (
                <ScenarioRoleProvider
                  isScenario={
                    !!(
                      trace.scenarioRunId ?? trace.attributes["scenario.run_id"]
                    )
                  }
                >
                  {/* Single persistent body wrapper — no key change → no
                    remount → heavy children stay mounted, viz state
                    survives. A short opacity dip on fetch reads as
                    "loading new content" without choreography. */}
                  <motion.div
                    ref={scrollContentRef}
                    animate={{ opacity: headerQuery.isFetching ? 0.55 : 1 }}
                    transition={{ duration: 0.12, ease: "easeOut" }}
                    style={{
                      flex: 1,
                      overflow: "auto",
                      // Tab switches conditionally remove the viz/conversation
                      // chrome above the panel. Without this, the browser's
                      // CSS scroll-anchoring picks an element that's about to
                      // be unmounted and compensates by jumping scrollTop —
                      // landing the user at the bottom of the new tab.
                      overflowAnchor: "none",
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                    }}
                  >
                    {viewMode === "conversation" && trace.conversationId ? (
                      <IsolatedErrorBoundary
                        scope="Couldn't render conversation view"
                        resetKeys={[trace.conversationId, trace.traceId]}
                      >
                        <ConversationView
                          conversationId={trace.conversationId}
                          currentTraceId={trace.traceId}
                        />
                      </IsolatedErrorBoundary>
                    ) : (
                      <VStack align="stretch" gap={0}>
                        {trace.conversationId && (
                          <Box
                            data-section-label="Conversation context"
                            bg="bg.subtle"
                            borderTopWidth="1px"
                            borderBottomWidth="1px"
                            borderColor="border.muted"
                            paddingY={5}
                          >
                            <IsolatedErrorBoundary
                              scope="Couldn't render conversation context"
                              resetKeys={[trace.conversationId, trace.traceId]}
                            >
                              <ConversationContext
                                conversationId={trace.conversationId}
                                traceId={trace.traceId}
                              />
                            </IsolatedErrorBoundary>
                          </Box>
                        )}

                        <Box data-section-label="Visualisation">
                          <IsolatedErrorBoundary
                            scope="Couldn't render visualisation"
                            resetKeys={[trace.traceId, vizTab]}
                          >
                            <VizPlaceholder
                              vizTab={vizTab}
                              onVizTabChange={setVizTab}
                              trace={trace}
                              spans={spanTree}
                              isLoading={spanTreeQuery.isLoading}
                              selectedSpanId={selectedSpanId}
                              onSelectSpan={selectSpan}
                              onClearSpan={clearSpan}
                            />
                          </IsolatedErrorBoundary>
                        </Box>

                        <Box borderBottomWidth="1px" borderColor="border" />

                        <Box position="sticky" top={0} zIndex={2} bg="bg.panel">
                          <IsolatedErrorBoundary
                            scope="Couldn't render span tabs"
                            resetKeys={[trace.traceId]}
                          >
                            <SpanTabBar
                              spanTree={spanTree}
                              promptCount={
                                parseTracePromptIds(trace.attributes).length
                              }
                            />
                          </IsolatedErrorBoundary>
                        </Box>

                        {/* `minHeight: 100vh` reserves room for the active
                          panel so a tab swap can't briefly collapse the
                          body — `overflowAnchor: none` is set on the
                          scrollers but a sudden height drop would still
                          let the browser snap scrollTop. */}
                        <Box minHeight="100vh">
                          <IsolatedErrorBoundary
                            scope={`Couldn't render the ${activeTab} tab`}
                            resetKeys={[
                              trace.traceId,
                              activeTab,
                              selectedSpanId,
                            ]}
                          >
                            {activeTab === "llm" ? (
                              <LlmPanel trace={trace} spans={spanTree} />
                            ) : activeTab === "prompts" ? (
                              <PromptsPanel
                                trace={trace}
                                spans={spanTree}
                                onSelectSpan={selectSpan}
                              />
                            ) : (
                              <TraceAccordions
                                trace={trace}
                                spans={spanTree}
                                selectedSpan={selectedSpan}
                                activeTab={activeTab}
                                onSelectSpan={selectSpan}
                              />
                            )}
                          </IsolatedErrorBoundary>
                        </Box>
                      </VStack>
                    )}
                  </motion.div>
                  {(activeTab === "summary" || activeTab === "span") && (
                    <BelowFoldIndicator scrollRef={scrollContentRef} />
                  )}
                </ScenarioRoleProvider>
              ) : null}
            </VStack>
          </Drawer.Body>
        </Drawer.Content>
      </CodeBlock.AdapterProvider>
      <KeyboardShortcutsHelp
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </Drawer.Root>
  );
}

function ResizeEdgeGrip({
  onDoubleClick,
  isMaximized,
}: {
  onDoubleClick: () => void;
  isMaximized: boolean;
}) {
  // When the drawer is maximized, the only direction it can resize toward is
  // west (shrinking). When restored, the only direction is east (expanding).
  // The OS cursor reflects that — `w-resize` for the maximized state and
  // `e-resize` for the restored state. Double-click on the bar still toggles
  // between the two.
  const cursor = isMaximized ? "w-resize" : "e-resize";
  return (
    <Tooltip
      content="Double-click to expand · click again to restore"
      positioning={{ placement: "right" }}
      openDelay={500}
    >
      <Box
        position="absolute"
        top={0}
        bottom={0}
        left={0}
        width="6px"
        cursor={cursor}
        zIndex={2}
        onDoubleClick={onDoubleClick}
        _hover={{ "& > [data-edge-grip]": { opacity: 1 } }}
        aria-label="Drag edge to resize, double-click to toggle"
        // Doubles as the anchor point for the empty-state
        // onboarding hero during drawer-tour stages — the hero
        // queries `[data-edge-grip="true"]` and pins its right
        // boundary to this element's left edge so it never slides
        // under the drawer regardless of drawer width.
        data-edge-grip="true"
      >
        <Box
          data-edge-grip
          position="absolute"
          top="50%"
          left="2px"
          width="2px"
          height="32px"
          borderRadius="full"
          // When maximized the grip is the operator's only visible affordance
          // for restoring the drawer — pure white at full opacity makes it
          // pop against the page underneath, and a periodic east-bounce hints
          // that you can drag/double-click here to restore. When restored,
          // it falls back to the subtle muted state.
          bg={isMaximized ? "white" : "border.emphasized"}
          boxShadow={
            isMaximized ? "0 0 8px rgba(255, 255, 255, 0.6)" : undefined
          }
          opacity={isMaximized ? 0.95 : 0.35}
          transition="opacity 120ms ease, background 120ms ease"
          pointerEvents="none"
          css={
            isMaximized
              ? {
                  animation: "tracesV2EdgeGripBounce 1.6s ease-in-out infinite",
                  "@keyframes tracesV2EdgeGripBounce": {
                    "0%, 100%": { transform: "translate(0, -50%)" },
                    "40%": { transform: "translate(6px, -50%)" },
                    "60%": { transform: "translate(6px, -50%)" },
                  },
                }
              : { transform: "translateY(-50%)" }
          }
        />
      </Box>
    </Tooltip>
  );
}
