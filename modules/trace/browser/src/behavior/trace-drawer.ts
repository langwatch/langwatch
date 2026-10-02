import {
  readDrawerAncestors,
  readDrawerLocation,
  updateDrawerParams,
  useDrawerRouter,
} from "@langwatch/browser-host/drawer";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useCallback, useMemo } from "react";

import {
  DEFAULT_VIEW_MODE,
  type DrawerViewMode,
  isOccurredAtParam,
  isViewMode,
  MAX_PINNED_SPANS,
  readTraceDrawerAddress,
  serializePinnedSpansParam,
  TRACE_DRAWER_NAME,
  type TraceDrawerAddress,
  type VizTab,
  viewModeForEditState,
} from "../model/trace-drawer-params.ts";
import { type DrawerChromeState, drawerChrome } from "./drawer-chrome.store.ts";

/** A trace the reader navigated away from inside the drawer, and the view they left it on. */
export interface TraceHistoryEntry {
  traceId: string;
  viewMode: DrawerViewMode;
  /** The trace's `occurredAt` (ms since epoch), the partition-pruning hint its reads need. */
  occurredAtMs?: number;
}

/** What the trace drawer changes in the address; none of it is held anywhere else. */
interface TraceDrawerAddressActions {
  selectSpan: (spanId: string) => void;
  clearSpan: () => void;
  /** Jump to a span from anywhere in the drawer: the Trace view, waterfall, span selected. */
  openSpanInTrace: (spanId: string) => void;
  /** Turn edit mode on or off; the draft is started and dropped by `traceEditStore`. */
  setIsEditing: (value: boolean) => void;
  /** Apply a view and remember it as the reader's choice. */
  setViewMode: (mode: DrawerViewMode) => void;
  /** Apply a view for this one trace, leaving the reader's remembered choice alone. */
  setViewModeTransient: (mode: DrawerViewMode) => void;
  setVizTab: (tab: VizTab) => void;
  setVizTabTransient: (tab: VizTab) => void;
  pinSpan: (spanId: string) => void;
  unpinSpan: (spanId: string) => void;
  clearPinnedSpans: () => void;
  /** Fill in the partition hint from a resolved trace timestamp when the link carried none. */
  backfillOccurredAtMs: (occurredAtMs: number) => void;
}

/** The trace drawer as its callers read it: the address, the reader's chrome, and the writes. */
export interface TraceDrawerState
  extends
    DrawerChromeState,
    Omit<TraceDrawerAddress, "addressedViewMode" | "addressedVizTab">,
    TraceDrawerAddressActions {
  viewMode: DrawerViewMode;
  vizTab: VizTab;
  expectedSpanCount: number | null;
  /** The traces the reader came from inside this drawer, oldest first. */
  traceBackStack: TraceHistoryEntry[];
}

const addressNow = (): TraceDrawerAddress => readTraceDrawerAddress(readDrawerLocation().query);

/** Writes in place; a link naming no open trace drawer has nothing to write into. */
function writeAddress(updates: Record<string, string | undefined>): void {
  if (!addressNow().isOpen) return;
  updateDrawerParams(updates, { push: false });
}

function traceEntryOf({
  params,
}: {
  params: Record<string, unknown>;
}): TraceHistoryEntry | undefined {
  const { traceId, mode, t } = params;
  if (typeof traceId !== "string") return undefined;
  const occurredAt = typeof t === "string" && isOccurredAtParam(t) ? Number(t) : undefined;
  return {
    traceId,
    viewMode: typeof mode === "string" && isViewMode(mode) ? mode : DEFAULT_VIEW_MODE,
    ...(occurredAt !== undefined ? { occurredAtMs: occurredAt } : {}),
  };
}

/** The unbroken run of trace drawers directly beneath the open one. */
export function traceBackStackOf(state: unknown): TraceHistoryEntry[] {
  const run: TraceHistoryEntry[] = [];
  for (const ancestor of readDrawerAncestors(state).reverse()) {
    const entry = ancestor.drawer === TRACE_DRAWER_NAME ? traceEntryOf(ancestor) : undefined;
    if (!entry) break;
    run.unshift(entry);
  }
  return run;
}

function pinned({ ids, spanId }: { ids: string[]; spanId: string }): string[] {
  if (ids.includes(spanId) || ids.length >= MAX_PINNED_SPANS) return ids;
  return [...ids, spanId];
}

const addressActions: TraceDrawerAddressActions = {
  selectSpan: (spanId) => {
    drawerChrome.getState().expandSpanDetail();
    writeAddress({ span: spanId });
  },
  clearSpan: () => writeAddress({ span: undefined }),
  openSpanInTrace: (spanId) => {
    drawerChrome.getState().expandSpanDetail();
    writeAddress({ span: spanId, viz: "waterfall", mode: "trace" });
  },
  setIsEditing: (value) => writeAddress({ edit: value ? "1" : undefined }),
  setViewMode: (mode) => {
    drawerChrome.getState().rememberViewMode(mode);
    writeAddress({ mode });
  },
  setViewModeTransient: (mode) => writeAddress({ mode }),
  setVizTab: (tab) => {
    drawerChrome.getState().rememberVizTab(tab);
    writeAddress({ viz: tab });
  },
  setVizTabTransient: (tab) => writeAddress({ viz: tab }),
  pinSpan: (spanId) => {
    const { pinnedSpanIds } = addressNow();
    const next = pinned({ ids: pinnedSpanIds, spanId });
    if (next !== pinnedSpanIds) writeAddress({ pinnedSpans: serializePinnedSpansParam(next) });
  },
  unpinSpan: (spanId) => {
    const { pinnedSpanIds, selectedSpanId } = addressNow();
    if (!pinnedSpanIds.includes(spanId)) return;
    // Unpinning the active span tab clears the selection too, so no ghost tab is left behind.
    writeAddress({
      pinnedSpans: serializePinnedSpansParam(pinnedSpanIds.filter((id) => id !== spanId)),
      ...(selectedSpanId === spanId ? { span: undefined } : {}),
    });
  },
  clearPinnedSpans: () => writeAddress({ pinnedSpans: undefined }),
  backfillOccurredAtMs: (occurredAtMs) => {
    if (addressNow().occurredAtMs !== null) return;
    if (!Number.isFinite(occurredAtMs) || occurredAtMs <= 0) return;
    writeAddress({ t: String(Math.trunc(occurredAtMs)) });
  },
};

function composeState({
  address,
  backStack,
  chrome,
}: {
  address: TraceDrawerAddress;
  backStack: TraceHistoryEntry[];
  chrome: DrawerChromeState;
}): TraceDrawerState {
  const { addressedViewMode, addressedVizTab, ...identity } = address;
  const expected = chrome.expectedSpan;
  return {
    ...chrome,
    ...identity,
    viewMode: viewModeForEditState({
      viewMode: addressedViewMode ?? chrome.lastViewMode,
      isEditing: address.isEditing,
    }),
    vizTab: addressedVizTab ?? chrome.lastVizTab,
    expectedSpanCount: expected?.traceId === address.traceId ? expected.count : null,
    traceBackStack: backStack,
    ...addressActions,
  };
}

/**
 * Reads the trace drawer: which trace, span and view the address names, with the
 * reader's remembered layout beside it. Selectors work as on any store.
 */
export function useTraceDrawer<T>(selector: (state: TraceDrawerState) => T): T {
  const { query, state } = useDrawerRouter();
  const view = useMemo(
    () => ({ address: readTraceDrawerAddress(query), backStack: traceBackStackOf(state) }),
    [query, state],
  );
  return drawerChrome((chrome) => selector(composeState({ ...view, chrome })));
}

/** The same reading for event handlers and callbacks, taken from the address now. */
export function getTraceDrawer(): TraceDrawerState {
  const { query, state } = readDrawerLocation();
  return composeState({
    address: readTraceDrawerAddress(query),
    backStack: traceBackStackOf(state),
    chrome: drawerChrome.getState(),
  });
}

/** Closes the drawer when it is showing a trace; whatever other drawer is open is left alone. */
export function useDismissTraceDrawer(): () => void {
  const { closeDrawer } = useDrawer();
  return useCallback(() => {
    if (getTraceDrawer().isOpen) closeDrawer();
  }, [closeDrawer]);
}
