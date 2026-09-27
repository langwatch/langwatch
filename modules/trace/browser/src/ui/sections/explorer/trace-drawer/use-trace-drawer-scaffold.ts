import type { SpanTreeNode, TraceHeader } from "@langwatch/trace-contract";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import { useDrawerStore } from "../../../../behavior/drawer.store.ts";
import { api } from "../../../../behavior/trace-api.ts";
import { getTopDrawer, useDrawer } from "../../../../behavior/use-drawer.ts";
import { useConversationContext } from "../hooks/use-conversation-context.ts";
import { useConversationPrefetch } from "../hooks/use-conversation-prefetch.ts";
import { useDrawerUrlSync } from "../hooks/use-drawer-url-sync.ts";
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
 * The drawer's trace and span tree. The header keeps the previous trace's data
 * while the next loads, so a mismatched one reads as none; the captured tree
 * tells the header how many spans a correction removes.
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
  return { trace, spanTree, isLoading, headerQuery, spanTreeQuery };
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
 * Closes the drawer: in-flight trace reads are cancelled, the store clears
 * first (the page mounts from it), and the drawer stack is walked back only
 * when this drawer is on top of it. An unsaved correction asks first.
 */
function useCloseTraceDrawer(traceId: string | undefined) {
  // goBack pops only this entry, so a trace opened from another drawer returns to it.
  const { goBack, closeDrawer } = useDrawer();
  const setMaximized = useDrawerStore((s) => s.setMaximized);
  const trpcUtils = api.useUtils();
  const closeDrawerNow = useCallback(() => {
    if (traceId) {
      void trpcUtils.traces.header.cancel();
      void trpcUtils.traces.spanTree.cancel();
    }
    setMaximized(false);
    useDrawerStore.getState().closeDrawer();
    if (getTopDrawer() === "traceV2Details") goBack();
    else closeDrawer();
  }, [goBack, closeDrawer, setMaximized, trpcUtils, traceId]);
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
  const pinned = useDrawerStore((s) => s.pinned);
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
  // The drawer store owns traceId; the URL is only its serialisation.
  const traceId = useDrawerStore((s) => s.traceId) ?? undefined;
  useDrawerUrlSync();
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);

  const { trace, spanTree, isLoading, headerQuery, spanTreeQuery } = useDrawerTraceData(traceId);
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
