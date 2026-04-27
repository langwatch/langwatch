import { Box, Button, Skeleton, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Drawer } from "~/components/ui/drawer";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import type { DrawerTab, DrawerViewMode, VizTab } from "../../stores/drawerStore";
import { useDrawerStore } from "../../stores/drawerStore";
import { useTraceHeader } from "../../hooks/useTraceHeader";
import { useSpanTree } from "../../hooks/useSpanSummary";
import { useTraceDrawerNavigation } from "../../hooks/useTraceDrawerNavigation";
import { useThreadContext } from "../../hooks/useThreadContext";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { DrawerHeader } from "./DrawerHeader";
import { ContextualAlerts } from "./ContextualAlerts";
import { ConversationContext } from "./ConversationContext";
import { ConversationView } from "./ConversationView";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
import { VizPlaceholder } from "./VizPlaceholder";
import { SpanTabBar } from "./SpanTabBar";
import { TraceAccordions } from "./TraceAccordions";

export interface TraceV2DrawerShellProps {
  open?: boolean;
  onClose?: () => void;
  traceId?: string;
  span?: string;
  mode?: string;
  viz?: string;
}

export function TraceV2DrawerShell(_props: TraceV2DrawerShellProps) {
  const { closeDrawer, openDrawer } = useDrawer();
  const params = useDrawerParams();

  const traceId = params.traceId;
  const spanParam = params.span ?? null;
  const vizParam = (params.viz as VizTab | undefined) ?? "waterfall";

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
  // Only show the full-shell skeleton when we have NO header data at all.
  // Once seed data from the row (or hover prefetch) is available, render the
  // shell immediately; child sections handle their own per-section loading.
  const isLoading = headerQuery.isLoading && !trace;

  // Local UI state
  const [isMaximized, setIsMaximized] = useState(false);
  const [vizTab, setVizTab] = useState<VizTab>(vizParam);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(spanParam);
  const [activeTab, setActiveTab] = useState<DrawerTab>(spanParam ? "span" : "summary");
  const [contentKey, setContentKey] = useState(0);
  const [pinnedSpanIds, setPinnedSpanIds] = useState<string[]>([]);
  const viewMode = useDrawerStore((s) => s.viewMode);
  const setStoreViewMode = useDrawerStore((s) => s.setViewMode);
  const {
    navigateToTrace,
    goBack: goBackInTraceHistory,
    canGoBack,
    backStackDepth,
  } = useTraceDrawerNavigation();

  const handleViewModeChange = useCallback(
    (mode: DrawerViewMode) => {
      setStoreViewMode(mode);
    },
    [setStoreViewMode],
  );

  const selectedSpan = useMemo(
    () => (selectedSpanId ? spanTree.find((s) => s.spanId === selectedSpanId) ?? null : null),
    [selectedSpanId, spanTree],
  );

  // Sync from URL params when they change
  useEffect(() => {
    setVizTab(vizParam);
  }, [vizParam]);

  useEffect(() => {
    setSelectedSpanId(spanParam);
    setActiveTab(spanParam ? "span" : "summary");
  }, [spanParam]);

  // Reset state when trace changes
  useEffect(() => {
    setSelectedSpanId(spanParam);
    setActiveTab(spanParam ? "span" : "summary");
    setPinnedSpanIds([]);
    setContentKey((k) => k + 1);
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

  // Double-click anywhere outside the drawer panel to close. Single clicks are
  // intentionally ignored — the drawer is non-modal so users can interact with
  // the underlying page; only an explicit double-click means "I'm done with this
  // trace, get the panel out of my way."
  const drawerContentRef = useRef<HTMLDivElement>(null);
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

  const handleVizTabChange = useCallback((tab: VizTab) => {
    setVizTab(tab);
  }, []);

  const handleSelectSpan = useCallback((spanId: string) => {
    setSelectedSpanId(spanId);
    setActiveTab("span");
    storeSelectSpan(spanId);
  }, [storeSelectSpan]);

  const handleClearSpan = useCallback(() => {
    setSelectedSpanId(null);
    setActiveTab("summary");
    storeClearSpan();
  }, [storeClearSpan]);

  const handleTabChange = useCallback((tab: DrawerTab) => {
    setActiveTab(tab);
  }, []);

  const handleCloseSpanTab = useCallback(() => {
    setSelectedSpanId(null);
    setActiveTab("summary");
    storeClearSpan();
  }, [storeClearSpan]);

  const handlePinSpan = useCallback((spanId: string) => {
    setPinnedSpanIds((prev) =>
      prev.includes(spanId) ? prev : [...prev, spanId],
    );
  }, []);

  const handleUnpinSpan = useCallback((spanId: string) => {
    setPinnedSpanIds((prev) => prev.filter((id) => id !== spanId));
    if (selectedSpanId === spanId) {
      setSelectedSpanId(null);
      setActiveTab("summary");
      storeClearSpan();
    }
  }, [selectedSpanId, storeClearSpan]);

  const pinnedSpans = useMemo(
    () =>
      pinnedSpanIds
        .map((id) => spanTree.find((s) => s.spanId === id))
        .filter((s): s is SpanTreeNode => s != null),
    [pinnedSpanIds, spanTree],
  );

  const handleNavigateToTrace = useCallback(
    (newTraceId: string) => {
      openDrawer("traceV2Details", { traceId: newTraceId });
      setContentKey((k) => k + 1);
    },
    [openDrawer],
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
        case "j":
        case "J": {
          if (threadContext.next) {
            e.preventDefault();
            navigateToTrace({
              fromTraceId: trace.traceId,
              fromViewMode: viewMode,
              toTraceId: threadContext.next.traceId,
            });
          }
          break;
        }
        case "k":
        case "K": {
          if (threadContext.previous) {
            e.preventDefault();
            navigateToTrace({
              fromTraceId: trace.traceId,
              fromViewMode: viewMode,
              toTraceId: threadContext.previous.traceId,
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
          setVizTab("markdown");
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
        case "t":
        case "T": {
          e.preventDefault();
          setStoreViewMode("trace");
          break;
        }
        case "c":
        case "C": {
          if (trace.conversationId) {
            e.preventDefault();
            setStoreViewMode("conversation");
          }
          break;
        }
        case "m":
        case "M": {
          e.preventDefault();
          setIsMaximized((prev) => !prev);
          break;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    trace, traceId, selectedSpanId, viewMode,
    handleClearSpan, handleClose, setStoreViewMode,
    threadContext.next, threadContext.previous,
    spanTree, navigateToTrace, storeSelectSpan,
    canGoBack, goBackInTraceHistory, shortcutsOpen,
  ]);

  // Error state: trace not found or loading failed
  if (!isLoading && !trace) {
    return (
      <Drawer.Root
        open={true}
        placement="end"
        size="lg"
        onOpenChange={() => handleClose()}
      >
        <Drawer.Content>
          <Drawer.Body>
            <VStack justify="center" align="center" height="full" gap={3}>
              <Text color="fg.muted" textStyle="sm">
                {headerQuery.error
                  ? "This trace no longer exists"
                  : traceId
                    ? "Failed to load trace data"
                    : "No trace selected"}
              </Text>
              <Button
                size="sm"
                variant="solid"
                colorPalette="blue"
                onClick={handleClose}
              >
                Close
              </Button>
            </VStack>
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
                  viewMode={viewMode}
                  onViewModeChange={handleViewModeChange}
                  onToggleMaximized={handleToggleMaximized}
                  onClose={handleClose}
                  onShowShortcuts={() => setShortcutsOpen(true)}
                  canGoBack={canGoBack}
                  onGoBack={goBackInTraceHistory}
                  backStackDepth={backStackDepth}
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
              /* Content area — fades on switch */
              <Box
                key={contentKey}
                flex={1}
                overflow="auto"
                css={{
                  animation: "traceDrawerFadeIn 0.15s ease-in",
                  "@keyframes traceDrawerFadeIn": {
                    from: { opacity: 0 },
                    to: { opacity: 1 },
                  },
                }}
              >
                {viewMode === "conversation" && trace.conversationId ? (
                  <ConversationView
                    conversationId={trace.conversationId}
                    currentTraceId={trace.traceId}
                  />
                ) : (
                  <VStack align="stretch" gap={0}>
                    {/* Conversation context — sibling turns */}
                    <ConversationContext
                      conversationId={trace.conversationId}
                      traceId={trace.traceId}
                    />

                    {/* Contextual Alerts — Trace mode only */}
                    <ContextualAlerts trace={trace} />

                    {/* Visualization */}
                    <VizPlaceholder
                      vizTab={vizTab}
                      onVizTabChange={handleVizTabChange}
                      trace={trace}
                      spans={spanTree}
                      isLoading={spanTreeQuery.isLoading}
                      selectedSpanId={selectedSpanId}
                      onSelectSpan={handleSelectSpan}
                      onClearSpan={handleClearSpan}
                    />

                    <Box borderBottomWidth="1px" borderColor="border" />

                    {/* Tab Bar */}
                    <SpanTabBar
                      activeTab={activeTab}
                      onTabChange={handleTabChange}
                      selectedSpan={selectedSpan}
                      onCloseSpanTab={handleCloseSpanTab}
                      pinnedSpans={pinnedSpans}
                      onSelectSpan={handleSelectSpan}
                      onPinSpan={handlePinSpan}
                      onUnpinSpan={handleUnpinSpan}
                    />

                    {/* Accordions */}
                    <TraceAccordions
                      trace={trace}
                      spans={spanTree}
                      selectedSpan={selectedSpan}
                      activeTab={activeTab}
                      onSelectSpan={handleSelectSpan}
                    />
                  </VStack>
                )}
              </Box>
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
