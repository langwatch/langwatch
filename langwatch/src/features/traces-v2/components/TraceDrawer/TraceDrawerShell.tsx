import { Box, CodeBlock, Skeleton, VStack } from "@chakra-ui/react";
import { motion } from "motion/react";
import { useColorMode } from "~/components/ui/color-mode";
import { Drawer } from "~/components/ui/drawer";
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

  const setVizTab = useDrawerStore((s) => s.setVizTab);
  const selectSpan = useDrawerStore((s) => s.selectSpan);
  const clearSpan = useDrawerStore((s) => s.clearSpan);
  const toggleMaximized = useDrawerStore((s) => s.toggleMaximized);
  const setShortcutsOpen = useDrawerStore((s) => s.setShortcutsOpen);

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
      onOpenChange={() => handleClose()}
    >
      <CodeBlock.AdapterProvider value={shikiAdapter}>
        <Drawer.Content
          ref={drawerContentRef}
          paddingX={0}
          maxWidth={isMaximized ? undefined : "45%"}
          transition="max-width 0.2s ease"
          // Anchor for the empty-state onboarding tour: a global
          // CSS rule keyed off `body[data-traces-tour-stage]`
          // applies a soft blue glow to this element during
          // `drawerOverview` so the user knows where the tour copy
          // is pointing. No-op outside the onboarding journey.
          data-tour-target="drawer"
        >
          <ResizeEdgeGrip onDoubleClick={toggleMaximized} />
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
                <VStack align="stretch" gap={2} padding={4}>
                  <Skeleton height="40px" borderRadius="md" />
                  <Skeleton height="24px" borderRadius="md" />
                </VStack>
              ) : (
                <Box onDoubleClick={toggleMaximized}>
                  <DrawerHeader trace={trace} onClose={handleClose} />
                </Box>
              )}

              <Box borderBottomWidth="1px" borderColor="border" />

              {isLoading ? (
                <VStack align="stretch" gap={2} padding={4}>
                  <Skeleton height="120px" borderRadius="md" />
                  <Skeleton height="32px" borderRadius="md" />
                  <Skeleton height="80px" borderRadius="md" />
                  <Skeleton height="80px" borderRadius="md" />
                </VStack>
              ) : trace ? (
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
                      <ConversationView
                        conversationId={trace.conversationId}
                        currentTraceId={trace.traceId}
                      />
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
                            <ConversationContext
                              conversationId={trace.conversationId}
                              traceId={trace.traceId}
                            />
                          </Box>
                        )}

                        <Box data-section-label="Visualisation">
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
                        </Box>

                        <Box borderBottomWidth="1px" borderColor="border" />

                        <Box position="sticky" top={0} zIndex={2} bg="bg.panel">
                          <SpanTabBar
                            spanTree={spanTree}
                            promptCount={
                              parseTracePromptIds(trace.attributes).length
                            }
                          />
                        </Box>

                        {/* `minHeight: 100vh` reserves room for the active
                          panel so a tab swap can't briefly collapse the
                          body — `overflowAnchor: none` is set on the
                          scrollers but a sudden height drop would still
                          let the browser snap scrollTop. */}
                        <Box minHeight="100vh">
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

function ResizeEdgeGrip({ onDoubleClick }: { onDoubleClick: () => void }) {
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
        cursor="ew-resize"
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
          transform="translateY(-50%)"
          width="2px"
          height="32px"
          borderRadius="full"
          bg="border.emphasized"
          opacity={0.35}
          transition="opacity 120ms ease"
          pointerEvents="none"
        />
      </Box>
    </Tooltip>
  );
}
