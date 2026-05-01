import { create } from "zustand";

export type DrawerViewMode = "trace" | "conversation";
export type VizTab =
  | "waterfall"
  | "flame"
  | "spanlist"
  | "topology"
  | "sequence";
export type DrawerTab = "summary" | "span" | "llm" | "prompts";

type AccordionSection = "events" | "evals" | "conversation";

interface TraceHistoryEntry {
  traceId: string;
  viewMode: DrawerViewMode;
  /**
   * The trace's `occurredAt` timestamp (ms since epoch) at the time it was
   * pushed onto the back stack. Carrying this lets back-navigation forward
   * the partition-pruning hint to the drawer queries — without it, going
   * back loses the hint and re-opens the drawer on a cold partition scan.
   */
  occurredAtMs?: number;
}

/**
 * The slice of drawer state that is mirrored into the URL. Owning these in
 * one shape keeps the URL ↔ store sync hook to a single diff + push.
 */
export interface DrawerUrlState {
  viewMode: DrawerViewMode;
  vizTab: VizTab;
  activeTab: DrawerTab;
  selectedSpanId: string | null;
}

interface DrawerState extends DrawerUrlState {
  isOpen: boolean;
  isMaximized: boolean;
  shortcutsOpen: boolean;
  /**
   * When true, clicking outside the drawer panel does NOT dismiss it —
   * the user closes via the explicit X button, Esc, or double-click.
   * When false, the drawer behaves like a standard modal: click-outside
   * (or Esc) closes it. Persisted to localStorage so the operator's
   * preference survives reloads.
   */
  pinned: boolean;
  traceId: string | null;
  /**
   * Trace's approximate occurredAt (ms epoch). Threaded into per-trace
   * queries as a partition-pruning hint on `stored_spans`.
   */
  occurredAtMs: number | null;
  pinnedSpanIds: string[];

  eventsExpanded: boolean;
  evalsExpanded: boolean;
  conversationExpanded: boolean;

  traceBackStack: TraceHistoryEntry[];

  openTrace: (traceId: string, occurredAtMs?: number | null) => void;
  closeDrawer: () => void;
  selectSpan: (spanId: string) => void;
  clearSpan: () => void;
  setViewMode: (mode: DrawerViewMode) => void;
  setVizTab: (tab: VizTab) => void;
  setActiveTab: (tab: DrawerTab) => void;
  setMaximized: (value: boolean) => void;
  toggleMaximized: () => void;
  setShortcutsOpen: (value: boolean) => void;
  setPinned: (value: boolean) => void;
  togglePinned: () => void;
  pinSpan: (spanId: string) => void;
  unpinSpan: (spanId: string) => void;
  clearPinnedSpans: () => void;
  toggleAccordion: (section: AccordionSection) => void;
  pushTraceHistory: (entry: TraceHistoryEntry) => void;
  popTraceHistory: () => TraceHistoryEntry | null;
  /**
   * Drop everything *above* `index` in the back stack and return the
   * entry at `index` (which becomes the navigation target). Used by the
   * back-button context menu so the user can jump multiple steps back
   * in one action without re-traversing the stack.
   */
  popTraceHistoryTo: (index: number) => TraceHistoryEntry | null;
  /** Apply URL-derived state to the store (mount hydration, popstate). */
  hydrateUrlState: (next: Partial<DrawerUrlState>) => void;
}

interface InitialFromURL extends DrawerUrlState {
  traceId: string | null;
  occurredAtMs: number | null;
  isOpen: boolean;
}

function isViewMode(value: string | null): value is DrawerViewMode {
  return value === "trace" || value === "conversation";
}

function isVizTab(value: string | null): value is VizTab {
  return (
    value === "waterfall" ||
    value === "flame" ||
    value === "spanlist" ||
    value === "topology" ||
    value === "sequence"
  );
}

function isDrawerTab(value: string | null): value is DrawerTab {
  return (
    value === "summary" ||
    value === "span" ||
    value === "llm" ||
    value === "prompts"
  );
}

/**
 * Read drawer state out of the URL synchronously at module load. Without
 * this, a hard reload onto `?drawer.open=traceV2Details&drawer.traceId=…`
 * would render the drawer once with `traceId === null` and any consumer
 * reading from the store gets a "trace not found" flash before the URL
 * sync effect fires.
 */
function readInitialFromURL(): InitialFromURL {
  const fallback: InitialFromURL = {
    traceId: null,
    occurredAtMs: null,
    selectedSpanId: null,
    viewMode: "trace",
    vizTab: "waterfall",
    activeTab: "summary",
    isOpen: false,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const params = new URLSearchParams(window.location.search);
    const isOpen = params.get("drawer.open") === "traceV2Details";
    const traceId = params.get("drawer.traceId");
    const tRaw = params.get("drawer.t");
    const t = tRaw ? Number(tRaw) : NaN;
    const occurredAtMs = Number.isFinite(t) && t > 0 ? t : null;
    const selectedSpanId = params.get("drawer.span");
    const mode = params.get("drawer.mode");
    const vizRaw = params.get("drawer.viz");
    const tabRaw = params.get("drawer.tab");

    const viewMode: DrawerViewMode = isViewMode(mode) ? mode : "trace";
    const vizTab: VizTab = isVizTab(vizRaw) ? vizRaw : "waterfall";
    const activeTab: DrawerTab = isDrawerTab(tabRaw)
      ? tabRaw
      : selectedSpanId
        ? "span"
        : "summary";

    return {
      traceId,
      occurredAtMs,
      selectedSpanId,
      viewMode,
      vizTab,
      activeTab,
      isOpen: isOpen && !!traceId,
    };
  } catch {
    return fallback;
  }
}

const initial = readInitialFromURL();

const PINNED_STORAGE_KEY = "langwatch:traces-v2:drawer-pinned:v1";

function readPinnedFromStorage(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

function persistPinned(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_STORAGE_KEY, String(value));
  } catch {
    // Best-effort persistence — quota errors / disabled storage just lose
    // the preference for this session.
  }
}

export const useDrawerStore = create<DrawerState>((set, get) => ({
  isOpen: initial.isOpen,
  isMaximized: false,
  shortcutsOpen: false,
  pinned: readPinnedFromStorage(),
  traceId: initial.traceId,
  occurredAtMs: initial.occurredAtMs,
  selectedSpanId: initial.selectedSpanId,
  viewMode: initial.viewMode,
  vizTab: initial.vizTab,
  activeTab: initial.activeTab,
  pinnedSpanIds: [],
  eventsExpanded: false,
  evalsExpanded: false,
  conversationExpanded: false,

  traceBackStack: [],

  openTrace: (traceId, occurredAtMs) =>
    set({
      isOpen: true,
      traceId,
      occurredAtMs: occurredAtMs ?? null,
      selectedSpanId: null,
      activeTab: "summary",
      pinnedSpanIds: [],
    }),

  closeDrawer: () =>
    set({
      isOpen: false,
      isMaximized: false,
      shortcutsOpen: false,
      traceId: null,
      occurredAtMs: null,
      selectedSpanId: null,
      pinnedSpanIds: [],
      traceBackStack: [],
    }),

  selectSpan: (spanId) => set({ selectedSpanId: spanId, activeTab: "span" }),

  clearSpan: () => set({ selectedSpanId: null, activeTab: "summary" }),

  setViewMode: (mode) => set({ viewMode: mode }),
  setVizTab: (tab) => set({ vizTab: tab }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setMaximized: (value) => set({ isMaximized: value }),
  toggleMaximized: () => set((s) => ({ isMaximized: !s.isMaximized })),
  setShortcutsOpen: (value) => set({ shortcutsOpen: value }),

  setPinned: (value) => {
    persistPinned(value);
    set({ pinned: value });
  },
  togglePinned: () =>
    set((s) => {
      const next = !s.pinned;
      persistPinned(next);
      return { pinned: next };
    }),

  pinSpan: (spanId) =>
    set((s) =>
      s.pinnedSpanIds.includes(spanId)
        ? s
        : { pinnedSpanIds: [...s.pinnedSpanIds, spanId] },
    ),

  unpinSpan: (spanId) =>
    set((s) => {
      if (!s.pinnedSpanIds.includes(spanId)) return s;
      const next: Partial<DrawerState> = {
        pinnedSpanIds: s.pinnedSpanIds.filter((id) => id !== spanId),
      };
      // Unpinning the active span tab clears the selection so we don't
      // leave a hanging "ghost" tab pointing at a span that's no longer
      // part of the strip.
      if (s.selectedSpanId === spanId) {
        next.selectedSpanId = null;
        next.activeTab = "summary";
      }
      return next;
    }),

  clearPinnedSpans: () => set({ pinnedSpanIds: [] }),

  toggleAccordion: (section) =>
    set((s) => {
      switch (section) {
        case "events":
          return { eventsExpanded: !s.eventsExpanded };
        case "evals":
          return { evalsExpanded: !s.evalsExpanded };
        case "conversation":
          return { conversationExpanded: !s.conversationExpanded };
      }
    }),

  pushTraceHistory: (entry) =>
    set((s) => {
      const top = s.traceBackStack[s.traceBackStack.length - 1];
      if (
        top &&
        top.traceId === entry.traceId &&
        top.viewMode === entry.viewMode
      ) {
        return s;
      }
      return { traceBackStack: [...s.traceBackStack, entry] };
    }),

  popTraceHistory: () => {
    const stack = get().traceBackStack;
    if (stack.length === 0) return null;
    const previous = stack[stack.length - 1] ?? null;
    set({ traceBackStack: stack.slice(0, -1) });
    return previous;
  },

  popTraceHistoryTo: (index: number) => {
    const stack = get().traceBackStack;
    if (index < 0 || index >= stack.length) return null;
    const target = stack[index] ?? null;
    set({ traceBackStack: stack.slice(0, index) });
    return target;
  },

  hydrateUrlState: (next) =>
    set((s) => {
      const patch: Partial<DrawerState> = {};
      if (next.viewMode !== undefined && next.viewMode !== s.viewMode) {
        patch.viewMode = next.viewMode;
      }
      if (next.vizTab !== undefined && next.vizTab !== s.vizTab) {
        patch.vizTab = next.vizTab;
      }
      if (next.activeTab !== undefined && next.activeTab !== s.activeTab) {
        patch.activeTab = next.activeTab;
      }
      if (
        next.selectedSpanId !== undefined &&
        next.selectedSpanId !== s.selectedSpanId
      ) {
        patch.selectedSpanId = next.selectedSpanId;
      }
      return Object.keys(patch).length === 0 ? s : patch;
    }),
}));

export { isViewMode, isVizTab, isDrawerTab };
