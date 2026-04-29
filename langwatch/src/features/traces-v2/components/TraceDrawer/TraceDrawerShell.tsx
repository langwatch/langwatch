import { Box, Skeleton, VStack } from "@chakra-ui/react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Drawer } from "~/components/ui/drawer";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useConversationContext } from "../../hooks/useConversationContext";
import { useConversationPrefetch } from "../../hooks/useConversationPrefetch";
import { useDrawerUrlSync } from "../../hooks/useDrawerUrlSync";
import { usePrefetchSpanDetail } from "../../hooks/usePrefetchSpanDetail";
import { useSpanTree } from "../../hooks/useSpanTree";
import { useTraceDrawerNavigation } from "../../hooks/useTraceDrawerNavigation";
import { useTraceDrawerShortcuts } from "../../hooks/useTraceDrawerShortcuts";
import { useTraceHeader } from "../../hooks/useTraceHeader";
import { useTraceRefresh } from "../../hooks/useTraceRefresh";
import { useDrawerStore } from "../../stores/drawerStore";
import { parseTracePromptIds } from "../../utils/promptAttributes";
import { BelowFoldIndicator } from "./BelowFoldIndicator";
import { ConversationContext } from "./ConversationContext";
import { ConversationView } from "./conversationView";
import { LlmPanel } from "./LlmPanel";
import { PromptsPanel } from "./PromptsPanel";
import { DrawerHeader } from "./drawerHeader";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
import { ScenarioRoleProvider } from "./scenarioRoles";
import { SpanTabBar } from "./SpanTabBar";
import { TraceAccordions } from "./traceAccordions";
import { TraceDrawerEmptyState } from "./TraceDrawerEmptyState";
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
  const { closeDrawer } = useDrawer();
  const params = useDrawerParams();

  const traceId = params.traceId;
  const occurredAtMsParam = useMemo(() => {
    if (!params.t) return null;
    const n = Number(params.t);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [params.t]);

  // Hydrate the per-trace identity into the store so the data hooks
  // (header, span tree, evaluations, …) can read it via selector. We skip
  // the call when the store already matches the URL — without that guard,
  // a hard reload onto `?traceId=X&span=Y` would call `openTrace` and
  // wipe the span the URL just hydrated.
  const openTraceInStore = useDrawerStore((s) => s.openTrace);
  useEffect(() => {
    if (!traceId) return;
    const { traceId: storeTraceId, occurredAtMs } = useDrawerStore.getState();
    if (storeTraceId === traceId && occurredAtMs === occurredAtMsParam) return;
    openTraceInStore(traceId, occurredAtMsParam);
  }, [traceId, occurredAtMsParam, openTraceInStore]);

  // Single source of truth — the drawer store. Url is just a serialization.
  useDrawerUrlSync();

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
  const setMaximized = useDrawerStore((s) => s.setMaximized);
  const setShortcutsOpen = useDrawerStore((s) => s.setShortcutsOpen);

  // Data
  const headerQuery = useTraceHeader();
  const spanTreeQuery = useSpanTree();
  const trace = headerQuery.data ?? null;
  const spanTree = spanTreeQuery.data ?? [];
  // Show the full-shell skeleton whenever we have a traceId in the URL but
  // no result yet — including the moment before the project context has
  // loaded and the query is still disabled. Without this guard, hard
  // reloading a drawer URL renders the 404 page for one frame before the
  // refetch even runs.
  const isLoading = traceId ? !trace && !headerQuery.error : false;

  const conversationContext = useConversationContext(
    trace?.conversationId ?? null,
    trace?.traceId ?? null,
  );
  // Warm sibling trace headers so navigating between turns is instant.
  useConversationPrefetch(
    trace?.conversationId ?? null,
    trace?.traceId ?? null,
  );

  const {
    navigateToTrace,
    goBack: goBackInTraceHistory,
    canGoBack,
  } = useTraceDrawerNavigation();

  // Same hook DrawerHeader's refresh button uses — re-instantiated here so
  // the `R` shortcut can fire even if the header is in a refreshing-spinner
  // state. The hook is memoized per traceId, so duplicating it is free.
  const { refresh: refreshActiveTrace } = useTraceRefresh(traceId ?? "");

  const selectedSpan = useMemo(
    () =>
      selectedSpanId
        ? (spanTree.find((s) => s.spanId === selectedSpanId) ?? null)
        : null,
    [selectedSpanId, spanTree],
  );

  // Prefetch the previous + next span's detail whenever a span is selected
  // so [/] navigation feels instantaneous.
  const prefetchSpan = usePrefetchSpanDetail();
  useEffect(() => {
    if (!selectedSpanId || spanTree.length === 0) return;
    const idx = spanTree.findIndex((s) => s.spanId === selectedSpanId);
    if (idx === -1) return;
    const prev = spanTree[idx - 1];
    const next = spanTree[idx + 1];
    if (prev) prefetchSpan(prev.spanId);
    if (next) prefetchSpan(next.spanId);
  }, [selectedSpanId, spanTree, prefetchSpan]);

  const handleClose = useCallback(() => {
    setMaximized(false);
    closeDrawer();
  }, [closeDrawer, setMaximized]);

  // Double-click anywhere outside the drawer panel to close. Single clicks
  // are intentionally ignored — the drawer is non-modal so users can
  // interact with the underlying page; only an explicit double-click means
  // "I'm done with this trace."
  const drawerContentRef = useRef<HTMLDivElement>(null);
  const drawerBodyRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleDoubleClick = (e: MouseEvent) => {
      const content = drawerContentRef.current;
      if (!content) return;
      const target = e.target as Node | null;
      if (target && content.contains(target)) return;
      handleClose();
    };
    document.addEventListener("dblclick", handleDoubleClick);
    return () => document.removeEventListener("dblclick", handleDoubleClick);
  }, [handleClose]);

  useTraceDrawerShortcuts({
    trace,
    spanTree,
    conversationContext,
    navigateToTrace,
    goBack: goBackInTraceHistory,
    canGoBack,
    refreshActiveTrace,
    onClose: handleClose,
  });

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
      <Drawer.Content
        ref={drawerContentRef}
        paddingX={0}
        maxWidth={isMaximized ? undefined : "45%"}
        transition="max-width 0.2s ease"
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
                  !!(trace.scenarioRunId ?? trace.attributes["scenario.run_id"])
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
                          paddingY={2}
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

                      <Box
                        position="sticky"
                        top={0}
                        zIndex={2}
                        bg="bg.panel"
                      >
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
