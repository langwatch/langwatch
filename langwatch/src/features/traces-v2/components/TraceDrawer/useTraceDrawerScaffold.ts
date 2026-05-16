import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useDrawer } from "~/hooks/useDrawer";
import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";
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
  // `goBack` so closing the v2 drawer pops just our entry off the
  // drawer stack — e.g. clicking ✕ from a trace opened via the
  // scenarioRunDetail drawer restores that scenario drawer instead
  // of nuking the whole drawer-state (which `closeDrawer` would do,
  // also stripping the `span` and other shared params from the URL).
  // `goBack` itself falls back to `closeDrawer` when the stack is at
  // its root, so deep links still close cleanly.
  const { goBack } = useDrawer();

  // The drawer store is the source of truth for `traceId` — see
  // `useTraceDrawerUrlHydrator` (mounted at the page level) for the
  // URL → store sync. Reading from the store here avoids the close →
  // immediate reopen race where the URL push lags one tick behind the
  // synchronous `store.openTrace` call, which previously read as a
  // brief "No trace selected" empty state between drawers.
  const traceId = useDrawerStore((s) => s.traceId) ?? undefined;

  // Single source of truth — the drawer store. URL is just a serialization.
  useDrawerUrlSync();

  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);
  const setMaximized = useDrawerStore((s) => s.setMaximized);

  const headerQuery = useTraceHeader();
  const spanTreeQuery = useSpanTree();
  // `useTraceHeader` uses React Query's `keepPreviousData`, so the
  // previous trace's data lingers until the new fetch resolves. That
  // matters now that the drawer is mounted optimistically: switching
  // from trace A → close → open trace B no longer unmounts the hook,
  // so without an explicit id match check we'd briefly show A's
  // header chips, conversation context, etc. under the new selection.
  // Guard by traceId match; the spans tree is keyed on traceId too.
  const trace =
    headerQuery.data && headerQuery.data.traceId === traceId
      ? headerQuery.data
      : null;
  const spanTree =
    spanTreeQuery.data && trace ? spanTreeQuery.data : [];
  // Show the full-shell skeleton whenever we have a traceId in the URL but
  // no result yet — including the moment before the project context has
  // loaded and the query is still disabled. Without this guard, hard
  // reloading a drawer URL renders the 404 page for one frame before the
  // refetch even runs. Also covers the A→B reopen case above (no `trace`
  // until the matching fetch lands).
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

  const trpcUtils = api.useUtils();
  const handleClose = useCallback(() => {
    // Cancel any in-flight per-trace queries so closing during a slow
    // load doesn't leave the request running in the background, racing
    // against a future re-open of the same drawer (or a different
    // trace) and burning bandwidth/CH cycles for a result nobody is
    // waiting on. React Query rolls cancellation through the AbortController
    // we plumb through tRPC, so this is a no-op when the request has
    // already settled.
    if (traceId) {
      void trpcUtils.tracesV2.header.cancel();
      void trpcUtils.tracesV2.spanTree.cancel();
    }
    setMaximized(false);
    // Clear the store first — the page-level mount in `TracesPage`
    // reads `traceId` from here, so unmounting it synchronously
    // matches the click flow's synchronous open. The URL push that
    // follows is just cleanup for deep-link / browser-history.
    useDrawerStore.getState().closeDrawer();
    goBack();
  }, [goBack, setMaximized, trpcUtils, traceId]);

  const drawerContentRef = useRef<HTMLDivElement>(null);
  const drawerBodyRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);

  // Double-click anywhere outside the drawer panel to close. Only relevant
  // in the *pinned* mode — when unpinned, the drawer is modal and a single
  // click outside already dismisses it, so the dblclick gesture would just
  // be a redundant second close path that fights the modal backdrop.
  const pinned = useDrawerStore((s) => s.pinned);
  useEffect(() => {
    if (!pinned) return;
    const handleDoubleClick = (e: MouseEvent) => {
      const content = drawerContentRef.current;
      if (!content) return;
      const target = e.target as Node | null;
      if (target && content.contains(target)) return;
      handleClose();
    };
    document.addEventListener("dblclick", handleDoubleClick);
    return () => document.removeEventListener("dblclick", handleDoubleClick);
  }, [handleClose, pinned]);

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
