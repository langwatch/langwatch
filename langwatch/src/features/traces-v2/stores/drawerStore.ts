import { create } from "zustand";

export type DrawerViewMode = "trace" | "summary" | "conversation";
// Flame + spanlist were retired during the trace-view redesign; see
// VizPlaceholder.TABS for the rationale. URL params from before the
// redesign that point at the removed values fall back to "waterfall"
// via the isVizTab guard below.
export type VizTab = "waterfall" | "topology" | "sequence";
// "summary" / "llm" / "prompts" were removed from the SpanTabBar in the
// redesign — Summary is now its own DrawerViewMode, and LLM / prompts
// content is auto-selected based on the span's kind inside SpanDetailPane.
// Only "span" remains as the active body mode (set whenever a span is
// selected).
export type DrawerTab = "span";

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
 *
 * `activeTab` used to live here when the SpanDetailPane mixed trace-scope
 * tabs (Summary / LLM / Prompts) with span-scope tabs. After the redesign
 * the pane shows a span detail whenever `selectedSpanId` is set and the
 * body adapts to the span's kind — there's no separate tab choice for the
 * user to make, so `activeTab` was retired.
 */
export interface DrawerUrlState {
  viewMode: DrawerViewMode;
  vizTab: VizTab;
  selectedSpanId: string | null;
  /**
   * Pinned span ids in the SpanTabBar, in the order they were pinned.
   * Persisted via the `drawer.pinnedSpans` URL param (comma-separated)
   * so links into the drawer can carry the operator's open tabs. Capped
   * at {@link MAX_PINNED_SPANS} both on read and on write so a runaway
   * pin loop can't bloat the URL.
   */
  pinnedSpanIds: string[];
}

/** Hard cap on the number of pinned span tabs (URL + memory). */
export const MAX_PINNED_SPANS = 8;

/**
 * Per-pane state inside the drawer body. Panes are independently sizable
 * (via `<PanelResizeHandle>`), collapsible to a header bar, and
 * temporarily maximizable within their group (double-click on header
 * hides siblings until toggled off). See trace-drawer-panes.feature.
 */
export interface PaneState {
  collapsed: boolean;
  /** When set, this pane is maximized within its PanelGroup. */
  maximizedWithinGroup: boolean;
}

export type PaneId = "conversationContext" | "visualization" | "spanDetail";

interface DrawerState extends DrawerUrlState {
  isOpen: boolean;
  isMaximized: boolean;
  shortcutsOpen: boolean;
  /**
   * Operator-driven drawer width in pixels. `null` means "fall back to
   * the default 45% viewport rule". When the user drags the left-edge
   * grip we write the resolved pixel value here so the drawer position
   * follows the cursor in real time. Persisted to localStorage.
   */
  widthPx: number | null;
  /**
   * Snapshot of `widthPx` taken before maximizing so the next
   * double-click on the grip can restore the operator's chosen width
   * rather than the abstract 45% default.
   */
  preMaximizeWidthPx: number | null;
  /** Per-pane state keyed by `PaneId`. Persisted. */
  paneState: Record<PaneId, PaneState>;
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
  /**
   * Persist the operator's chosen viz tab AND apply it. Use for any
   * UI-initiated change (tab click, keyboard shortcut, overflow menu).
   */
  setVizTab: (tab: VizTab) => void;
  /**
   * Apply a viz tab without writing to localStorage. Use for programmatic
   * one-off forcing (e.g. preview/onboarding traces always landing on
   * the waterfall) so the operator's remembered preference isn't
   * clobbered the next time they open a normal trace.
   */
  setVizTabTransient: (tab: VizTab) => void;
  setMaximized: (value: boolean) => void;
  toggleMaximized: () => void;
  setWidthPx: (px: number | null) => void;
  /**
   * Double-click handler: if not at the snap-maximize width, snap to it
   * (remembering the current width); if already snapped, restore the
   * remembered width.
   */
  toggleSnapMaximize: (viewportWidth: number) => void;
  togglePaneCollapsed: (id: PaneId) => void;
  togglePaneMaximized: (id: PaneId) => void;
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
  return value === "trace" || value === "summary" || value === "conversation";
}

function isVizTab(value: string | null): value is VizTab {
  // "flame" and "spanlist" used to be valid here; URLs from before the
  // redesign carrying those values just fall through to the default
  // (waterfall) when the guard returns false.
  return value === "waterfall" || value === "topology" || value === "sequence";
}

// `isDrawerTab` retired alongside `activeTab` — the SpanDetailPane body
// is now selected automatically from the selected span's kind, so the
// store doesn't expose a tab choice for callers to validate.

/**
 * Persisted last-chosen drawer view mode. Read at boot to decide which
 * mode a freshly-opened trace lands in (when the URL doesn't pin one
 * explicitly), and written every time the user picks a mode from
 * ModeSwitch. Lets observability-first users (who pick Summary) keep
 * landing on Summary as they navigate between traces.
 */
const LAST_VIEW_MODE_STORAGE_KEY = "langwatch:traces-v2:drawer-last-mode:v1";
const LAST_VIZ_TAB_STORAGE_KEY = "langwatch:traces-v2:drawer-last-viz:v1";

function loadLastViewMode(): DrawerViewMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_VIEW_MODE_STORAGE_KEY);
    return raw && isViewMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

function persistLastViewMode(mode: DrawerViewMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // storage may be full / disabled
  }
}

function loadLastVizTab(): VizTab | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_VIZ_TAB_STORAGE_KEY);
    return raw && isVizTab(raw) ? raw : null;
  } catch {
    return null;
  }
}

function persistLastVizTab(tab: VizTab): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LAST_VIZ_TAB_STORAGE_KEY, tab);
  } catch {
    // storage may be full / disabled
  }
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
    // Summary is the friendlier landing tab for users who haven't
    // expressed a preference yet — it shows trace I/O + metadata + evals
    // at a glance, which is what most non-engineering operators are
    // looking for. Engineers who default to the waterfall flip once
    // and the choice persists via localStorage.
    viewMode: "summary",
    vizTab: "waterfall",
    pinnedSpanIds: [],
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
    const pinnedRaw = params.get("drawer.pinnedSpans");

    // URL wins. Otherwise fall back to the user's last-chosen mode
    // (persisted via the ModeSwitch action), then to "trace" if nothing
    // is remembered yet. The localStorage fallback is what lets users
    // who prefer Summary keep landing on Summary across traces.
    const viewMode: DrawerViewMode = isViewMode(mode)
      ? mode
      : (loadLastViewMode() ?? "summary");
    const vizTab: VizTab = isVizTab(vizRaw)
      ? vizRaw
      : (loadLastVizTab() ?? "waterfall");
    const pinnedSpanIds = parsePinnedSpansParam(pinnedRaw);

    return {
      traceId,
      occurredAtMs,
      selectedSpanId,
      viewMode,
      vizTab,
      pinnedSpanIds,
      isOpen: isOpen && !!traceId,
    };
  } catch {
    return fallback;
  }
}

/**
 * Parse the `drawer.pinnedSpans` URL param into a deduplicated, capped
 * id list. Empty / malformed values become `[]` rather than throwing so
 * a bad query string can't break drawer hydration.
 */
export function parsePinnedSpansParam(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PINNED_SPANS) break;
  }
  return out;
}

/** Inverse of {@link parsePinnedSpansParam} — serialises for the URL. */
export function serializePinnedSpansParam(
  ids: readonly string[],
): string | undefined {
  if (ids.length === 0) return undefined;
  return ids.slice(0, MAX_PINNED_SPANS).join(",");
}

function arraysShallowEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const initial = readInitialFromURL();

const PINNED_STORAGE_KEY = "langwatch:traces-v2:drawer-pinned:v1";
const WIDTH_STORAGE_KEY = "langwatch:traces-v2:drawer-width-px:v1";
// Bumped to v2 with the conversationContext default flipped to collapsed.
// Bumping the key resets everyone to the new default; users who flipped
// it open in v1 will need to flip again, but that's the right migration
// for "starts closed now."
const PANE_STATE_STORAGE_KEY = "langwatch:traces-v2:drawer-pane-state:v2";

/** Drawer width clamps. Min so chrome stays usable; max so the page edge
 * remains clickable for the "click-outside" affordance. */
export const DRAWER_MIN_WIDTH_PX = 360;
export const DRAWER_MAXIMIZE_EDGE_PX = 10;
export const DRAWER_RESTORE_EDGE_PX = 80;

/**
 * Initial drawer width before the operator has dragged it once.
 * Flat px (no viewport % math) so first-paint is deterministic — the
 * previous `45%` fallback meant the drawer width visibly shifted
 * after the user first dragged because the persisted px and the
 * computed % rarely matched. Once the operator drags, the chosen
 * width is persisted to localStorage and this default no longer
 * applies. Clamped at the call sites against the current viewport.
 */
export const DRAWER_DEFAULT_WIDTH_PX = 920;

const DEFAULT_PANE_STATE: Record<PaneId, PaneState> = {
  // Conversation context starts collapsed by default — most traces are
  // single-turn anyway, and the user can flip it open per-session via
  // the chevron (preference persists in localStorage).
  conversationContext: { collapsed: true, maximizedWithinGroup: false },
  visualization: { collapsed: false, maximizedWithinGroup: false },
  spanDetail: { collapsed: false, maximizedWithinGroup: false },
};

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

function readWidthFromStorage(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Clamp the persisted value against the *current* viewport so that
    // a width remembered on a wide monitor doesn't push the drawer off
    // the right edge when reloaded on a smaller laptop. The ResizeRail
    // also re-clamps on `window.resize`, but that listener can't catch
    // the initial-load case where the viewport changed between
    // sessions.
    const maxWidth = window.innerWidth - DRAWER_MAXIMIZE_EDGE_PX;
    return Math.max(DRAWER_MIN_WIDTH_PX, Math.min(n, maxWidth));
  } catch {
    return null;
  }
}

function persistWidth(value: number | null) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.localStorage.removeItem(WIDTH_STORAGE_KEY);
    } else {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(value)));
    }
  } catch {
    // Best-effort persistence.
  }
}

function readPaneStateFromStorage(): Record<PaneId, PaneState> {
  if (typeof window === "undefined") return DEFAULT_PANE_STATE;
  try {
    const raw = window.localStorage.getItem(PANE_STATE_STORAGE_KEY);
    if (raw === null) return DEFAULT_PANE_STATE;
    const parsed = JSON.parse(raw) as Partial<Record<PaneId, PaneState>>;
    return {
      conversationContext:
        parsed.conversationContext ?? DEFAULT_PANE_STATE.conversationContext,
      visualization: parsed.visualization ?? DEFAULT_PANE_STATE.visualization,
      spanDetail: parsed.spanDetail ?? DEFAULT_PANE_STATE.spanDetail,
    };
  } catch {
    return DEFAULT_PANE_STATE;
  }
}

function persistPaneState(value: Record<PaneId, PaneState>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PANE_STATE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Best-effort persistence.
  }
}

export const useDrawerStore = create<DrawerState>((set, get) => ({
  isOpen: initial.isOpen,
  isMaximized: false,
  shortcutsOpen: false,
  pinned: readPinnedFromStorage(),
  widthPx: readWidthFromStorage(),
  preMaximizeWidthPx: null,
  paneState: readPaneStateFromStorage(),
  traceId: initial.traceId,
  occurredAtMs: initial.occurredAtMs,
  selectedSpanId: initial.selectedSpanId,
  viewMode: initial.viewMode,
  vizTab: initial.vizTab,
  pinnedSpanIds: initial.pinnedSpanIds,
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

  selectSpan: (spanId) =>
    set((s) => {
      // Selecting a span always reopens the detail pane. Collapsing
      // the pane no longer clears the selection (see
      // `togglePaneCollapsed`), so re-opening the pane lands on the
      // same span the operator last inspected; clicking a new span
      // updates the selection and re-expands the pane in one step.
      const next: Partial<DrawerState> = { selectedSpanId: spanId };
      if (s.paneState.spanDetail.collapsed) {
        const updatedPanes: Record<PaneId, PaneState> = {
          ...s.paneState,
          spanDetail: { ...s.paneState.spanDetail, collapsed: false },
        };
        persistPaneState(updatedPanes);
        next.paneState = updatedPanes;
      }
      return next;
    }),

  clearSpan: () => set({ selectedSpanId: null }),

  setViewMode: (mode) => {
    // Remember the user's last explicit mode choice so the next trace
    // they open lands here instead of bouncing back to the default.
    persistLastViewMode(mode);
    set({ viewMode: mode });
  },
  setVizTab: (tab) => {
    persistLastVizTab(tab);
    set({ vizTab: tab });
  },
  setVizTabTransient: (tab) => set({ vizTab: tab }),
  setMaximized: (value) => set({ isMaximized: value }),
  toggleMaximized: () => set((s) => ({ isMaximized: !s.isMaximized })),

  setWidthPx: (px) => {
    const next = px === null ? null : Math.max(DRAWER_MIN_WIDTH_PX, px);
    persistWidth(next);
    set({ widthPx: next });
  },

  toggleSnapMaximize: (viewportWidth) =>
    set((s) => {
      const snapWidth = Math.max(
        DRAWER_MIN_WIDTH_PX,
        viewportWidth - DRAWER_MAXIMIZE_EDGE_PX,
      );
      const isAtSnap =
        s.widthPx !== null && Math.abs(s.widthPx - snapWidth) < 2;
      if (isAtSnap) {
        const restore =
          s.preMaximizeWidthPx ?? Math.min(DRAWER_DEFAULT_WIDTH_PX, snapWidth);
        persistWidth(restore);
        return {
          widthPx: restore,
          preMaximizeWidthPx: null,
          isMaximized: false,
        };
      }
      persistWidth(snapWidth);
      return {
        preMaximizeWidthPx:
          s.widthPx ?? Math.min(DRAWER_DEFAULT_WIDTH_PX, snapWidth),
        widthPx: snapWidth,
        isMaximized: true,
      };
    }),

  togglePaneCollapsed: (id) =>
    set((s) => {
      const wasCollapsed = s.paneState[id].collapsed;
      const next: Record<PaneId, PaneState> = {
        ...s.paneState,
        [id]: {
          ...s.paneState[id],
          collapsed: !wasCollapsed,
          // Collapsing a maximized pane is nonsensical — drop maximize.
          maximizedWithinGroup: false,
        },
      };
      persistPaneState(next);
      // Selection is preserved across collapse/uncollapse — operator
      // feedback: hiding the pane and showing it again should land on
      // the same span they were inspecting, not blank the selection.
      // (Selection still clears via explicit `clearSpan` and the X
      // affordance in the SpanTabBar.)
      return { paneState: next };
    }),

  togglePaneMaximized: (id) =>
    set((s) => {
      const currentlyMaximized = s.paneState[id].maximizedWithinGroup;
      // Maximizing one pane should demote every sibling — exactly-one
      // pane can be maximized at a time. Without this normalization a
      // sequence of clicks could leave several panes flagged maximized
      // and `PaneLayout` would hide all of them at once.
      const next: Record<PaneId, PaneState> = (
        Object.keys(s.paneState) as PaneId[]
      ).reduce(
        (acc, key) => {
          acc[key] = {
            ...s.paneState[key],
            maximizedWithinGroup: key === id ? !currentlyMaximized : false,
            collapsed: key === id ? false : s.paneState[key].collapsed,
          };
          return acc;
        },
        {} as Record<PaneId, PaneState>,
      );
      persistPaneState(next);
      return { paneState: next };
    }),
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
    set((s) => {
      if (s.pinnedSpanIds.includes(spanId)) return s;
      // Cap at MAX_PINNED_SPANS so the URL serialisation can't blow up
      // and so the SpanTabBar doesn't grow into a wrapped row.
      if (s.pinnedSpanIds.length >= MAX_PINNED_SPANS) return s;
      return { pinnedSpanIds: [...s.pinnedSpanIds, spanId] };
    }),

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
      if (
        next.selectedSpanId !== undefined &&
        next.selectedSpanId !== s.selectedSpanId
      ) {
        patch.selectedSpanId = next.selectedSpanId;
      }
      if (
        next.pinnedSpanIds !== undefined &&
        !arraysShallowEqual(next.pinnedSpanIds, s.pinnedSpanIds)
      ) {
        patch.pinnedSpanIds = next.pinnedSpanIds;
      }
      return Object.keys(patch).length === 0 ? s : patch;
    }),
}));

export { isViewMode, isVizTab };
