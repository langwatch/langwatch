import { Box, Skeleton, VStack } from "@chakra-ui/react";
import { motion } from "motion/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Drawer } from "~/components/ui/drawer";
import { Tooltip } from "~/components/ui/tooltip";
import {
  useDrawer,
  useDrawerParams,
  useUpdateDrawerParams,
} from "~/hooks/useDrawer";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { usePrefetchSpanDetail } from "../../hooks/usePrefetchSpanDetail";
import { useSpanTree } from "../../hooks/useSpanSummary";
import { useThreadContext } from "../../hooks/useThreadContext";
import { useThreadPrefetch } from "../../hooks/useThreadPrefetch";
import { useTraceDrawerNavigation } from "../../hooks/useTraceDrawerNavigation";
import { useTraceHeader } from "../../hooks/useTraceHeader";
import { useTraceRefresh } from "../../hooks/useTraceRefresh";
import type {
  DrawerTab,
  DrawerViewMode,
  VizTab,
} from "../../stores/drawerStore";
import { useDrawerStore } from "../../stores/drawerStore";
import { parseTracePromptIds } from "../../utils/promptAttributes";
import { BelowFoldIndicator } from "./BelowFoldIndicator";
import { ConversationContext } from "./ConversationContext";
// ConversationView only renders when the user toggles into conversation
// mode — code-split so the trace-mode initial bundle stays light.
const ConversationView = lazy(() =>
  import("./conversationView").then((m) => ({ default: m.ConversationView })),
);
import { DrawerHeader } from "./drawerHeader";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
// LlmPanel + PromptsPanel are only rendered when their tabs are active.
// Lazy-load so the LLM-tab-only Markdown / Shiki cost (and the Prompts-tab
// only chip rendering) doesn't bloat the trace drawer's initial bundle.
const LlmPanel = lazy(() =>
  import("./LlmPanel").then((m) => ({ default: m.LlmPanel })),
);
const PromptsPanel = lazy(() =>
  import("./PromptsPanel").then((m) => ({ default: m.PromptsPanel })),
);
import { SpanTabBar } from "./SpanTabBar";
import { ScenarioRoleProvider } from "./scenarioRoles";
import { TraceDrawerEmptyState } from "./TraceDrawerEmptyState";
import { TraceAccordions } from "./traceAccordions";
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
  const spanParam = params.span ?? null;
  // Coerce legacy "markdown" URL value to "waterfall" — that view moved to
  // the lower SpanTabBar as a "LLM" tab and is no longer a viz option.
  const rawViz = params.viz as string | undefined;
  const vizParam: VizTab =
    rawViz === "waterfall" ||
    rawViz === "flame" ||
    rawViz === "spanlist" ||
    rawViz === "topology" ||
    rawViz === "sequence"
      ? rawViz
      : "waterfall";

  const rawTab = params.tab as string | undefined;
  const tabParam: DrawerTab | null =
    rawTab === "summary" ||
    rawTab === "span" ||
    rawTab === "llm" ||
    rawTab === "prompts" ||
    rawTab === "annotations"
      ? rawTab
      : null;

  const rawMode = params.mode as string | undefined;
  const modeParam: DrawerViewMode =
    rawMode === "trace" || rawMode === "conversation" ? rawMode : "trace";

  const updateDrawerParams = useUpdateDrawerParams();

  // Sync URL params → zustand store so hooks can read from it
  const storeOpenTrace = useDrawerStore((s) => s.openTrace);
  const storeSelectSpan = useDrawerStore((s) => s.selectSpan);
  const storeClearSpan = useDrawerStore((s) => s.clearSpan);

  useEffect(() => {
    if (traceId) {
      storeOpenTrace(traceId);
    }
  }, [traceId, storeOpenTrace]);

  useEffect(() => {
    if (spanParam) {
      storeSelectSpan(spanParam);
    } else {
      storeClearSpan();
    }
  }, [spanParam, storeSelectSpan, storeClearSpan]);

  // Fetch real data from ClickHouse via tRPC
  const headerQuery = useTraceHeader();
  const spanTreeQuery = useSpanTree();

  const trace = headerQuery.data ?? null;
  const spanTree = spanTreeQuery.data ?? [];
  // Show the full-shell skeleton whenever we have a traceId in the URL
  // but no result yet — including the moment before the project context
  // has loaded and the query is still disabled. Without this guard, hard
  // reloading a drawer URL renders the 404 page for one frame before the
  // refetch even runs. Once data (or an error) arrives we drop into the
  // normal shell or empty state respectively.
  const isLoading = traceId ? !trace && !headerQuery.error : false;

  // Local UI state
  const [isMaximized, setIsMaximized] = useState(false);
  const [vizTab, setVizTab] = useState<VizTab>(vizParam);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(
    spanParam,
  );
  const [activeTab, setActiveTab] = useState<DrawerTab>(
    tabParam ?? (spanParam ? "span" : "summary"),
  );
  const [pinnedSpanIds, setPinnedSpanIds] = useState<string[]>([]);
  const [viewMode, setViewModeLocal] = useState<DrawerViewMode>(modeParam);
  const setStoreViewMode = useDrawerStore((s) => s.setViewMode);
  const setViewMode = useCallback(
    (mode: DrawerViewMode) => {
      setViewModeLocal(mode);
      setStoreViewMode(mode);
    },
    [setStoreViewMode],
  );
  const setStoreVizTab = useDrawerStore((s) => s.setVizTab);
  const setStoreActiveTab = useDrawerStore((s) => s.setActiveTab);

  // Mirror local drawer UI state into the global drawerStore so that
  // out-of-tree consumers (multiplayer presence, in particular) can read
  // the active panel/tab without threading it through props.
  useEffect(() => {
    setStoreVizTab(vizTab);
  }, [vizTab, setStoreVizTab]);

  useEffect(() => {
    setStoreActiveTab(activeTab);
  }, [activeTab, setStoreActiveTab]);
  const {
    navigateToTrace,
    goBack: goBackInTraceHistory,
    canGoBack,
    backStackDepth,
  } = useTraceDrawerNavigation();

  // Same hook DrawerHeader's refresh button uses — we re-instantiate
  // it here so the `R` shortcut can fire even if the header is in a
  // refreshing-spinner state. The hook is memoized per traceId so
  // duplicating it does not mean duplicate work.
  const { refresh: refreshActiveTrace } = useTraceRefresh(traceId ?? "");

  const selectedSpan = useMemo(
    () =>
      selectedSpanId
        ? (spanTree.find((s) => s.spanId === selectedSpanId) ?? null)
        : null,
    [selectedSpanId, spanTree],
  );

  // Prefetch the previous + next span's detail whenever a span is selected
  // so [/] navigation feels instantaneous. Without this, switching with the
  // arrow shortcuts shows the loading skeleton on every step.
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

  // ── URL ↔ state bidirectional sync ──────────────────────────────────────
  // Reading: when URL params change (browser back/forward, paste-in URL,
  // tab restore), pull the values back into local state.
  useEffect(() => {
    setVizTab(vizParam);
  }, [vizParam]);

  useEffect(() => {
    if (tabParam && tabParam !== activeTab) setActiveTab(tabParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  useEffect(() => {
    if (modeParam !== viewMode) setViewMode(modeParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeParam]);

  // Writing: when local state diverges from URL params, push a history
  // entry so back/forward walks the user's tab navigation. The push only
  // fires when state ≠ URL, so the URL → state effect above never causes
  // a feedback loop.
  useEffect(() => {
    if (vizTab !== vizParam) updateDrawerParams({ viz: vizTab });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vizTab]);

  useEffect(() => {
    if (activeTab !== tabParam) updateDrawerParams({ tab: activeTab });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (viewMode !== modeParam) updateDrawerParams({ mode: viewMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  useEffect(() => {
    setSelectedSpanId(spanParam);
    setActiveTab(spanParam ? "span" : "summary");
  }, [spanParam]);

  // Reset transient span state when the trace changes. We deliberately do
  // NOT bump `contentKey` here — that would unmount the whole content tree
  // on every J/K press, which is what made rapid back-and-forth feel laggy.
  // The "current row" pop in ConversationContext already gives a per-press
  // visual cue without the cost of remounting the visualizer + accordions.
  useEffect(() => {
    setSelectedSpanId(spanParam);
    setActiveTab(spanParam ? "span" : "summary");
    setPinnedSpanIds([]);
  }, [traceId, spanParam]);

  const handleClose = useCallback(() => {
    setIsMaximized(false);
    closeDrawer();
  }, [closeDrawer]);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Sibling navigation in conversation thread (J / K shortcuts)
  const threadContext = useThreadContext(
    trace?.conversationId ?? null,
    trace?.traceId ?? null,
  );

  // Warm sibling trace headers so navigating between turns is instant.
  useThreadPrefetch(trace?.conversationId ?? null, trace?.traceId ?? null);

  // Lockout for thread navigation: ignore J/K presses while a navigation is
  // in flight, plus 500ms of grace time after the fetch completes. Stops the
  // user from queueing up a stack of overlapping nudges if they hammer J.
  const NAV_GRACE_MS = 500;
  const navLockedRef = useRef(false);
  useEffect(() => {
    if (headerQuery.isFetching) {
      navLockedRef.current = true;
      return;
    }
    const id = setTimeout(() => {
      navLockedRef.current = false;
    }, NAV_GRACE_MS);
    return () => clearTimeout(id);
  }, [headerQuery.isFetching]);

  // Direction the user is moving in the conversation thread, derived from
  // the change in thread position. Drives the body's slide animation: J
  // (forward) slides left → in, K (backward) slides right → in. -1 = forward,
  // +1 = backward, 0 = no slide (initial / non-thread navigation).
  const prevThreadPosRef = useRef<number | null>(null);
  const [navDirection, setNavDirection] = useState<-1 | 0 | 1>(0);
  useEffect(() => {
    const next = threadContext.position;
    const prev = prevThreadPosRef.current;
    prevThreadPosRef.current = next;
    if (prev == null || next == null || prev === next) {
      setNavDirection(0);
      return;
    }
    setNavDirection(next > prev ? -1 : 1);
    const id = setTimeout(() => setNavDirection(0), 360);
    return () => clearTimeout(id);
  }, [threadContext.position, traceId]);

  // Double-click anywhere outside the drawer panel to close. Single clicks are
  // intentionally ignored — the drawer is non-modal so users can interact with
  // the underlying page; only an explicit double-click means "I'm done with this
  // trace, get the panel out of my way."
  const drawerContentRef = useRef<HTMLDivElement>(null);
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

  const handleToggleMaximized = useCallback(() => {
    setIsMaximized((prev) => !prev);
  }, []);

  const handleSelectSpan = useCallback(
    (spanId: string) => {
      setSelectedSpanId(spanId);
      setActiveTab("span");
      storeSelectSpan(spanId);
    },
    [storeSelectSpan],
  );

  const handleClearSpan = useCallback(() => {
    setSelectedSpanId(null);
    setActiveTab("summary");
    storeClearSpan();
  }, [storeClearSpan]);

  const handlePinSpan = useCallback((spanId: string) => {
    setPinnedSpanIds((prev) =>
      prev.includes(spanId) ? prev : [...prev, spanId],
    );
  }, []);

  const handleUnpinSpan = useCallback(
    (spanId: string) => {
      setPinnedSpanIds((prev) => prev.filter((id) => id !== spanId));
      if (selectedSpanId === spanId) {
        setSelectedSpanId(null);
        setActiveTab("summary");
        storeClearSpan();
      }
    },
    [selectedSpanId, storeClearSpan],
  );

  const pinnedSpans = useMemo(
    () =>
      pinnedSpanIds
        .map((id) => spanTree.find((s) => s.spanId === id))
        .filter((s): s is SpanTreeNode => s != null),
    [pinnedSpanIds, spanTree],
  );

  // Keyboard shortcuts
  useEffect(() => {
    if (!trace) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isInputFocused) return;

      // Don't hijack OS chords. Without this guard, Ctrl/Cmd+C (copy) was
      // landing in the `case "c"` branch and switching to the conversation
      // tab instead of copying the selection. Same risk for Ctrl+V/X/T etc.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case "Escape": {
          e.preventDefault();
          if (shortcutsOpen) {
            setShortcutsOpen(false);
          } else if (selectedSpanId) {
            handleClearSpan();
          } else {
            handleClose();
          }
          break;
        }
        case "?": {
          e.preventDefault();
          setShortcutsOpen((v) => !v);
          break;
        }
        case "ArrowRight":
        case "j":
        case "J": {
          if (navLockedRef.current) {
            e.preventDefault();
            break;
          }
          if (threadContext.next) {
            e.preventDefault();
            navigateToTrace({
              fromTraceId: trace.traceId,
              fromViewMode: viewMode,
              toTraceId: threadContext.next.traceId,
              toTimestamp: threadContext.next.timestamp,
            });
          }
          break;
        }
        case "ArrowLeft":
        case "k":
        case "K": {
          if (navLockedRef.current) {
            e.preventDefault();
            break;
          }
          if (threadContext.previous) {
            e.preventDefault();
            navigateToTrace({
              fromTraceId: trace.traceId,
              fromViewMode: viewMode,
              toTraceId: threadContext.previous.traceId,
              toTimestamp: threadContext.previous.timestamp,
            });
          }
          break;
        }
        case "]": {
          if (spanTree.length > 0) {
            e.preventDefault();
            const idx = selectedSpanId
              ? spanTree.findIndex((s) => s.spanId === selectedSpanId)
              : -1;
            const next = spanTree[Math.min(idx + 1, spanTree.length - 1)];
            if (next) {
              setSelectedSpanId(next.spanId);
              setActiveTab("span");
              storeSelectSpan(next.spanId);
            }
          }
          break;
        }
        case "[": {
          if (spanTree.length > 0) {
            e.preventDefault();
            const idx = selectedSpanId
              ? spanTree.findIndex((s) => s.spanId === selectedSpanId)
              : 0;
            const prev = spanTree[Math.max(idx - 1, 0)];
            if (prev) {
              setSelectedSpanId(prev.spanId);
              setActiveTab("span");
              storeSelectSpan(prev.spanId);
            }
          }
          break;
        }
        case "b":
        case "B": {
          if (canGoBack) {
            e.preventDefault();
            goBackInTraceHistory();
          }
          break;
        }
        case "1": {
          e.preventDefault();
          setVizTab("waterfall");
          break;
        }
        case "2": {
          e.preventDefault();
          setVizTab("flame");
          break;
        }
        case "3": {
          e.preventDefault();
          setVizTab("spanlist");
          break;
        }
        case "4": {
          e.preventDefault();
          setVizTab("topology");
          break;
        }
        case "5": {
          e.preventDefault();
          setVizTab("sequence");
          break;
        }
        case "o":
        case "O": {
          if (selectedSpanId) {
            e.preventDefault();
            setActiveTab("summary");
          }
          break;
        }
        case "l":
        case "L": {
          e.preventDefault();
          setViewMode("trace");
          setActiveTab("llm");
          break;
        }
        case "p":
        case "P": {
          // Only available when this trace touched a managed prompt — same
          // gate as the tab visibility in SpanTabBar.
          if (
            trace.containsPrompt ||
            (trace.attributes["langwatch.prompt_ids"] ?? "").length > 0
          ) {
            e.preventDefault();
            setViewMode("trace");
            setActiveTab("prompts");
          }
          break;
        }
        case "t":
        case "T": {
          e.preventDefault();
          setViewMode("trace");
          break;
        }
        case "c":
        case "C": {
          if (trace.conversationId) {
            e.preventDefault();
            setViewMode("conversation");
          }
          break;
        }
        case "m":
        case "M": {
          e.preventDefault();
          setIsMaximized((prev) => !prev);
          break;
        }
        case "r":
        case "R": {
          e.preventDefault();
          void refreshActiveTrace();
          break;
        }
        case "y":
        case "Y": {
          e.preventDefault();
          void navigator.clipboard.writeText(trace.traceId);
          break;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    trace,
    traceId,
    selectedSpanId,
    viewMode,
    handleClearSpan,
    handleClose,
    setViewMode,
    threadContext.next,
    threadContext.previous,
    spanTree,
    navigateToTrace,
    storeSelectSpan,
    canGoBack,
    goBackInTraceHistory,
    shortcutsOpen,
    refreshActiveTrace,
  ]);

  // Error state: trace not found, network failure, or no selection.
  // The dedicated empty-state component differentiates 404 vs load-failed
  // and surfaces the trace ID + retry path.
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
            onDoubleClick={handleToggleMaximized}
            _hover={{
              "& > [data-edge-grip]": { opacity: 1 },
            }}
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
        <Drawer.Body paddingY={0} paddingX={0} overflowY="auto">
          <VStack align="stretch" gap={0} height="full">
            {/* Header — always visible, renders first */}
            {isLoading || !trace ? (
              <VStack align="stretch" gap={2} padding={4}>
                <Skeleton height="40px" borderRadius="md" />
                <Skeleton height="24px" borderRadius="md" />
              </VStack>
            ) : (
              <Box onDoubleClick={handleToggleMaximized}>
                <DrawerHeader
                  trace={trace}
                  isMaximized={isMaximized}
                  onSelectSpan={handleSelectSpan}
                  onOpenPromptsTab={() => setActiveTab("prompts")}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  onToggleMaximized={handleToggleMaximized}
                  onClose={handleClose}
                  onShowShortcuts={() => setShortcutsOpen(true)}
                  canGoBack={canGoBack}
                  onGoBack={goBackInTraceHistory}
                  backStackDepth={backStackDepth}
                  isNavigating={headerQuery.isFetching}
                />
              </Box>
            )}

            <Box borderBottomWidth="1px" borderColor="border" />

            {/* Loading skeleton state */}
            {isLoading ? (
              <VStack align="stretch" gap={2} padding={4}>
                <Skeleton height="120px" borderRadius="md" />
                <Skeleton height="32px" borderRadius="md" />
                <Skeleton height="80px" borderRadius="md" />
                <Skeleton height="80px" borderRadius="md" />
              </VStack>
            ) : trace ? (
              /* Crossfade + tiny direction-nudge during navigation. Single
                 persistent motion.div (no key change → no remount → heavy
                 children stay mounted, viz state survives). Opacity dips
                 and the body offsets a few pixels in the navigation
                 direction during the fetch; springs back when the new
                 trace lands. ~140ms total — reads as motion in peripheral
                 vision without paying the cost of an actual slide. */
              <ScenarioRoleProvider
                isScenario={
                  !!(trace.scenarioRunId ?? trace.attributes["scenario.run_id"])
                }
              >
                <motion.div
                  ref={scrollContentRef}
                  animate={{
                    opacity: headerQuery.isFetching ? 0.55 : 1,
                    x: headerQuery.isFetching ? navDirection * 12 : 0,
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 480,
                    damping: 38,
                    mass: 0.5,
                  }}
                  style={{
                    flex: 1,
                    overflow: "auto",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                  }}
                >
                  {viewMode === "conversation" && trace.conversationId ? (
                    <Suspense
                      fallback={
                        <VStack align="stretch" gap={2} padding={4}>
                          <Skeleton height="40px" borderRadius="md" />
                          <Skeleton height="80px" borderRadius="md" />
                          <Skeleton height="80px" borderRadius="md" />
                        </VStack>
                      }
                    >
                      <ConversationView
                        conversationId={trace.conversationId}
                        currentTraceId={trace.traceId}
                      />
                    </Suspense>
                  ) : (
                    <VStack align="stretch" gap={0} flex={1} minHeight={0}>
                      {/* The viz + conversation context are skipped on the
                        LLM tab — that view is a self-contained markdown
                        document for copying, so the chrome above it would
                        just push the prose down without adding signal. */}
                      {activeTab !== "llm" && (
                        <>
                          {trace.conversationId && (
                            <Box
                              data-section-label="Conversation context"
                              bg="bg.subtle"
                              borderTopWidth="1px"
                              borderBottomWidth="1px"
                              borderColor="border.muted"
                              paddingY={4}
                            >
                              <ConversationContext
                                conversationId={trace.conversationId}
                                traceId={trace.traceId}
                              />
                            </Box>
                          )}

                          <Box
                            data-section-label="Visualisation"
                            paddingTop={2}
                          >
                            <VizPlaceholder
                              vizTab={vizTab}
                              onVizTabChange={setVizTab}
                              trace={trace}
                              spans={spanTree}
                              isLoading={spanTreeQuery.isLoading}
                              selectedSpanId={selectedSpanId}
                              onSelectSpan={handleSelectSpan}
                              onClearSpan={handleClearSpan}
                            />
                          </Box>

                          <Box borderBottomWidth="1px" borderColor="border" />
                        </>
                      )}

                      <SpanTabBar
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                        selectedSpan={selectedSpan}
                        onCloseSpanTab={handleClearSpan}
                        pinnedSpans={pinnedSpans}
                        onSelectSpan={handleSelectSpan}
                        onPinSpan={handlePinSpan}
                        onUnpinSpan={handleUnpinSpan}
                        traceId={trace?.traceId}
                        promptCount={
                          parseTracePromptIds(trace.attributes).length
                        }
                      />

                      {activeTab === "llm" ? (
                        <Suspense
                          fallback={
                            <VStack align="stretch" gap={2} padding={4}>
                              <Skeleton height="40px" borderRadius="md" />
                              <Skeleton height="120px" borderRadius="md" />
                            </VStack>
                          }
                        >
                          <LlmPanel trace={trace} spans={spanTree} />
                        </Suspense>
                      ) : activeTab === "prompts" ? (
                        <Suspense
                          fallback={
                            <VStack align="stretch" gap={2} padding={4}>
                              <Skeleton height="40px" borderRadius="md" />
                              <Skeleton height="60px" borderRadius="md" />
                            </VStack>
                          }
                        >
                          <PromptsPanel
                            trace={trace}
                            spans={spanTree}
                            onSelectSpan={handleSelectSpan}
                          />
                        </Suspense>
                      ) : (
                        <TraceAccordions
                          trace={trace}
                          spans={spanTree}
                          selectedSpan={selectedSpan}
                          activeTab={activeTab}
                          onSelectSpan={handleSelectSpan}
                        />
                      )}
                    </VStack>
                  )}
                </motion.div>
                <BelowFoldIndicator scrollRef={scrollContentRef} />
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
