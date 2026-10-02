import { defineSlice } from "@langwatch/browser-host/global-store";

import {
  DEFAULT_VIEW_MODE,
  DEFAULT_VIZ_TAB,
  type DrawerViewMode,
  type VizTab,
} from "../model/trace-drawer-params.ts";

type AccordionSection = "events" | "evals" | "conversation";

/**
 * Per-pane state inside the drawer body. Panes are independently sizable (via
 * `<PanelResizeHandle>`), collapsible to a header bar, and temporarily maximizable
 * within their group (double-click on header hides siblings until toggled off).
 */
interface PaneState {
  collapsed: boolean;
  /** When set, this pane is maximized within its PanelGroup. */
  maximizedWithinGroup: boolean;
}

type PaneId = "conversationContext" | "visualization" | "spanDetail";

/** Drawer width clamps. Min so chrome stays usable; max so the page edge stays clickable. */
export const DRAWER_MIN_WIDTH_PX = 360;
export const DRAWER_MAXIMIZE_EDGE_PX = 10;

/** Initial drawer width before the operator has dragged it once. */
export const DRAWER_DEFAULT_WIDTH_PX = 920;

const DEFAULT_PANE_STATE: Record<PaneId, PaneState> = {
  conversationContext: { collapsed: true, maximizedWithinGroup: false },
  visualization: { collapsed: false, maximizedWithinGroup: false },
  spanDetail: { collapsed: false, maximizedWithinGroup: false },
};

/**
 * What the trace drawer remembers that is not which trace it is on: the reader's
 * layout and last choices, and the hint the opening row left. Which trace, span and
 * view the drawer shows is the address, never held here.
 */
export interface DrawerChromeState {
  isMaximized: boolean;
  shortcutsOpen: boolean;
  /** Operator-driven width in pixels; `null` falls back to the default rule. */
  widthPx: number | null;
  /** `widthPx` before maximizing, so the next double-click can restore it. */
  preMaximizeWidthPx: number | null;
  paneState: Record<PaneId, PaneState>;
  /** When true, clicking outside the drawer does not dismiss it. */
  pinned: boolean;
  /** The view and viz tab the reader last chose, for a trace whose link names none. */
  lastViewMode: DrawerViewMode;
  lastVizTab: VizTab;
  /** The span count of the row that opened `traceId`, so the skeleton holds the right height. */
  expectedSpan: { traceId: string; count: number } | null;
  eventsExpanded: boolean;
  evalsExpanded: boolean;
  conversationExpanded: boolean;

  setMaximized: (value: boolean) => void;
  toggleMaximized: () => void;
  setWidthPx: (px: number | null) => void;
  /** Snap to the full width and remember the current one; at the snap width, restore it. */
  toggleSnapMaximize: (viewportWidth: number) => void;
  togglePaneCollapsed: (id: PaneId) => void;
  togglePaneMaximized: (id: PaneId) => void;
  /** Re-open the span detail pane, so a newly selected span is not hidden by a collapsed one. */
  expandSpanDetail: () => void;
  setShortcutsOpen: (value: boolean) => void;
  setPinned: (value: boolean) => void;
  togglePinned: () => void;
  toggleAccordion: (section: AccordionSection) => void;
  rememberViewMode: (mode: DrawerViewMode) => void;
  rememberVizTab: (tab: VizTab) => void;
  expectSpanCount: (hint: { traceId: string; count: number }) => void;
  /** The drawer closed: what only made sense while it was open goes. */
  reset: () => void;
}

function snapMaximized({
  state,
  viewportWidth,
}: {
  state: DrawerChromeState;
  viewportWidth: number;
}): Partial<DrawerChromeState> {
  const snapWidth = Math.max(DRAWER_MIN_WIDTH_PX, viewportWidth - DRAWER_MAXIMIZE_EDGE_PX);
  const isAtSnap = state.widthPx !== null && Math.abs(state.widthPx - snapWidth) < 2;
  if (isAtSnap) {
    const restore = state.preMaximizeWidthPx ?? Math.min(DRAWER_DEFAULT_WIDTH_PX, snapWidth);
    return { widthPx: restore, preMaximizeWidthPx: null, isMaximized: false };
  }
  return {
    preMaximizeWidthPx: state.widthPx ?? Math.min(DRAWER_DEFAULT_WIDTH_PX, snapWidth),
    widthPx: snapWidth,
    isMaximized: true,
  };
}

/** Exactly one pane can be maximized at a time; maximizing demotes every sibling. */
function maximizedPaneState({ s, id }: { s: DrawerChromeState; id: PaneId }) {
  const currentlyMaximized = s.paneState[id].maximizedWithinGroup;
  const demote = (key: PaneId): PaneState => ({
    ...s.paneState[key],
    maximizedWithinGroup: key === id ? !currentlyMaximized : false,
    collapsed: key === id ? false : s.paneState[key].collapsed,
  });
  return {
    conversationContext: demote("conversationContext"),
    visualization: demote("visualization"),
    spanDetail: demote("spanDetail"),
  };
}

function expandedSpanDetail(s: DrawerChromeState): Partial<DrawerChromeState> {
  if (!s.paneState.spanDetail.collapsed) return {};
  return {
    paneState: { ...s.paneState, spanDetail: { ...s.paneState.spanDetail, collapsed: false } },
  };
}

export const drawerChrome = defineSlice<DrawerChromeState>({
  name: "trace:drawer-chrome",
  create: (set) => ({
    isMaximized: false,
    shortcutsOpen: false,
    widthPx: null,
    preMaximizeWidthPx: null,
    paneState: DEFAULT_PANE_STATE,
    pinned: true,
    lastViewMode: DEFAULT_VIEW_MODE,
    lastVizTab: DEFAULT_VIZ_TAB,
    expectedSpan: null,
    eventsExpanded: false,
    evalsExpanded: false,
    conversationExpanded: false,

    setMaximized: (value) => set({ isMaximized: value }),
    toggleMaximized: () => set((s) => ({ isMaximized: !s.isMaximized })),

    setWidthPx: (px) => set({ widthPx: px === null ? null : Math.max(DRAWER_MIN_WIDTH_PX, px) }),

    toggleSnapMaximize: (viewportWidth) => set((s) => snapMaximized({ state: s, viewportWidth })),

    togglePaneCollapsed: (id) =>
      set((s) => ({
        paneState: {
          ...s.paneState,
          // Collapsing a maximized pane is nonsensical, so maximize drops with it.
          [id]: {
            ...s.paneState[id],
            collapsed: !s.paneState[id].collapsed,
            maximizedWithinGroup: false,
          },
        },
      })),

    togglePaneMaximized: (id) => set((s) => ({ paneState: maximizedPaneState({ s, id }) })),

    expandSpanDetail: () => set((s) => expandedSpanDetail(s)),

    setShortcutsOpen: (value) => set({ shortcutsOpen: value }),
    setPinned: (value) => set({ pinned: value }),
    togglePinned: () => set((s) => ({ pinned: !s.pinned })),

    toggleAccordion: (section) =>
      set((s) => {
        if (section === "events") return { eventsExpanded: !s.eventsExpanded };
        if (section === "evals") return { evalsExpanded: !s.evalsExpanded };
        return { conversationExpanded: !s.conversationExpanded };
      }),

    rememberViewMode: (mode) => set({ lastViewMode: mode }),
    rememberVizTab: (tab) => set({ lastVizTab: tab }),
    expectSpanCount: (hint) => set({ expectedSpan: hint }),

    reset: () => set({ isMaximized: false, shortcutsOpen: false, expectedSpan: null }),
  }),
  persist: {
    key: "langwatch:traces-v2:drawer-chrome",
    partialize: ({ pinned, widthPx, paneState, lastViewMode, lastVizTab }) => ({
      pinned,
      widthPx,
      paneState,
      lastViewMode,
      lastVizTab,
    }),
  },
});
