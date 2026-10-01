import { getTopDrawer, useDrawer } from "@langwatch/browser-host/use-drawer";
import type { SpanTreeNode, TraceHeader } from "@langwatch/trace-contract";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import { api } from "../../../../behavior/trace-api.ts";
import { useTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import { TRACE_DRAWER_NAME } from "../../../../model/trace-drawer-params.ts";
import { useConversationContext } from "../hooks/use-conversation-context.ts";
import { useConversationPrefetch } from "../hooks/use-conversation-prefetch.ts";
import { usePrefetchSpanDetail } from "../hooks/use-prefetch-span-detail.ts";
import { useSpanTreeWithCaptured } from "../hooks/use-span-tree.ts";
import { useTraceDrawerNavigation } from "../hooks/use-trace-drawer-navigation.ts";
import { useTraceDrawerShortcuts } from "../hooks/use-trace-drawer-shortcuts.ts";
import { useTraceHeader } from "../hooks/use-trace-header.ts";
import { useTraceRefresh } from "../hooks/use-trace-refresh.ts";
import { guardTraceEditExit } from "../utils/trace-edit-mode.ts";

interface TraceDrawerScaffold {
  traceId: string | undefined;
  trace: TraceHeader | null;
  spanTree: SpanTreeNode[];
  selectedSpan: SpanTreeNode | null;
  isLoading: boolean;
  /** The header is the list row's fields; what only the header read knows is still loading. */
  isPlaceholder: boolean;
  headerQuery: ReturnType<typeof useTraceHeader>;
  spanTreeQuery: ReturnType<typeof useSpanTreeWithCaptured>["corrected"];
  canGoBack: boolean;
  goBackInTraceHistory: () => void;
  handleClose: () => void;
  drawerContentRef: RefObject<HTMLDivElement | null>;
  drawerBodyRef: RefObject<HTMLDivElement | null>;
  scrollContentRef: RefObject<HTMLDivElement | null>;
}

/**
 * The drawer's trace and span tree. The header is the list row's fields while
 * the read loads, and a header for another trace reads as none; the captured
 * tree tells the header how many spans a correction removes.
 */
function useDrawerTraceData(traceId: string | undefined) {
  const { captured: capturedSpanTree, display: spanTreeQuery } = useSpanTreeWithCaptured();
  const headerQuery = useTraceHeader({ spans: capturedSpanTree.data });
  const trace = headerQuery.data && headerQuery.data.traceId === traceId ? headerQuery.data : null;
  const spanTree = useMemo(
    () => (spanTreeQuery.data && trace ? spanTreeQuery.data : []),
    [spanTreeQuery.data, trace],
  );
  // Loading whenever there is a trace to show but no result yet, project context included.
  const isLoading = traceId ? !trace && !headerQuery.error : false;
  const isPlaceholder = !!trace && headerQuery.isPlaceholderData;
  return { trace, spanTree, isLoading, isPlaceholder, headerQuery, spanTreeQuery };
}

/** Warms the spans either side of the selected one, so [ and ] feel instant. */
function useNeighbourSpanPrefetch({
  selectedSpanId,
  spanTree,
}: {
  selectedSpanId: string | null;
  spanTree: SpanTreeNode[];
}) {
  const prefetchSpan = usePrefetchSpanDetail();
  useEffect(() => {
    if (!selectedSpanId) return;
    const idx = spanTree.findIndex((s) => s.spanId === selectedSpanId);
    if (idx === -1) return;
    for (const neighbour of [spanTree[idx - 1], spanTree[idx + 1]]) {
      if (neighbour) prefetchSpan(neighbour.spanId);
    }
  }, [selectedSpanId, spanTree, prefetchSpan]);
}

/**
 * Closes the drawer: in-flight trace reads are cancelled, and the reader lands on
 * the drawer beneath the traces they walked through, if there is one. An unsaved
 * correction asks first.
 */
function useCloseTraceDrawer(traceId: string | undefined) {
  const { goBackTo, closeDrawer, backStack } = useDrawer();
  const traceBackStack = useTraceDrawer((s) => s.traceBackStack);
  const setMaximized = useTraceDrawer((s) => s.setMaximized);
  const trpcUtils = api.useUtils();
  const closeDrawerNow = useCallback(() => {
    if (traceId) {
      void trpcUtils.traces.header.cancel();
      void trpcUtils.traces.spanTree.cancel();
    }
    setMaximized(false);
    const beneath = backStack.length - traceBackStack.length - 1;
    if (getTopDrawer() === TRACE_DRAWER_NAME && beneath >= 0) goBackTo(beneath);
    else closeDrawer();
  }, [
    goBackTo,
    closeDrawer,
    setMaximized,
    trpcUtils,
    traceId,
    backStack.length,
    traceBackStack.length,
  ]);
  return useCallback(() => guardTraceEditExit(closeDrawerNow), [closeDrawerNow]);
}

/**
 * In pinned mode a double-click outside the panel closes it; unpinned, the
 * drawer is modal and one click outside already does.
 */
function useDoubleClickOutsideToClose({
  contentRef,
  onClose,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const pinned = useTraceDrawer((s) => s.pinned);
  useEffect(() => {
    if (!pinned) return;
    const handleDoubleClick = (e: MouseEvent) => {
      const content = contentRef.current;
      if (!content) return;
      if (e.target instanceof Node && content.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("dblclick", handleDoubleClick);
    return () => document.removeEventListener("dblclick", handleDoubleClick);
  }, [onClose, pinned, contentRef]);
}

/**
 * Data wiring + cross-cutting effects for the trace drawer.
 */
export function useTraceDrawerScaffold(): TraceDrawerScaffold {
  const traceId = useTraceDrawer((s) => s.traceId) ?? undefined;
  const selectedSpanId = useTraceDrawer((s) => s.selectedSpanId);

  const { trace, spanTree, isLoading, isPlaceholder, headerQuery, spanTreeQuery } =
    useDrawerTraceData(traceId);
  const conversationId = trace?.conversationId ?? null;
  const conversationTraceId = trace?.traceId ?? null;
  const conversationContext = useConversationContext(conversationId, conversationTraceId);
  // Warm sibling trace headers so navigating between turns is instant.
  useConversationPrefetch(conversationId, conversationTraceId);

  const { navigateToTrace, goBack: goBackInTraceHistory, canGoBack } = useTraceDrawerNavigation();
  // The header's refresh, again here so R works while the header spins; memoised per trace.
  const { refresh: refreshActiveTrace } = useTraceRefresh(traceId ?? "");

  const selectedSpan = useMemo(
    () => spanTree.find((s) => s.spanId === selectedSpanId) ?? null,
    [selectedSpanId, spanTree],
  );
  useNeighbourSpanPrefetch({ selectedSpanId, spanTree });

  const handleClose = useCloseTraceDrawer(traceId);
  const drawerContentRef = useRef<HTMLDivElement>(null);
  const drawerBodyRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  useDoubleClickOutsideToClose({ contentRef: drawerContentRef, onClose: handleClose });

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

  return {
    traceId,
    trace,
    spanTree,
    selectedSpan,
    isLoading,
    isPlaceholder,
    headerQuery,
    spanTreeQuery,
    canGoBack,
    goBackInTraceHistory,
    handleClose,
    drawerContentRef,
    drawerBodyRef,
    scrollContentRef,
  };
}
