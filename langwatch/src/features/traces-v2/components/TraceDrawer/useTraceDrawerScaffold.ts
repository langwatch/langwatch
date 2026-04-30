import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
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

interface TraceDrawerScaffold {
  traceId: string | undefined;
  trace: TraceHeader | null;
  spanTree: SpanTreeNode[];
  selectedSpan: SpanTreeNode | null;
  isLoading: boolean;
  headerQuery: ReturnType<typeof useTraceHeader>;
  spanTreeQuery: ReturnType<typeof useSpanTree>;
  canGoBack: boolean;
  goBackInTraceHistory: () => void;
  handleClose: () => void;
  drawerContentRef: RefObject<HTMLDivElement | null>;
  drawerBodyRef: RefObject<HTMLDivElement | null>;
  scrollContentRef: RefObject<HTMLDivElement | null>;
}

/**
 * Data wiring + cross-cutting effects for the trace drawer. Owns the
 * URL → store hydration, header/span-tree queries, conversation context,
 * navigation history, prefetch warmups, the close-on-outside-double-click
 * listener, and keyboard-shortcut binding. The consumer renders layout from
 * the returned values; UI state (viewMode, vizTab, etc.) is read directly
 * from `useDrawerStore` by the layout component.
 */
export function useTraceDrawerScaffold(): TraceDrawerScaffold {
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

  // Single source of truth — the drawer store. URL is just a serialization.
  useDrawerUrlSync();

  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);
  const setMaximized = useDrawerStore((s) => s.setMaximized);

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
  useConversationPrefetch(trace?.conversationId ?? null, trace?.traceId ?? null);

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

  const drawerContentRef = useRef<HTMLDivElement>(null);
  const drawerBodyRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);

  // Double-click anywhere outside the drawer panel to close. Single clicks
  // are intentionally ignored — the drawer is non-modal so users can
  // interact with the underlying page; only an explicit double-click means
  // "I'm done with this trace."
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
