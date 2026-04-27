import { create } from "zustand";

export type DrawerViewMode = "trace" | "conversation";
export type VizTab = "waterfall" | "flame" | "spanlist" | "markdown";
export type DrawerTab = "summary" | "span";

interface TraceHistoryEntry {
  traceId: string;
  viewMode: DrawerViewMode;
}

interface DrawerState {
  isOpen: boolean;
  isMaximized: boolean;
  traceId: string | null;
  selectedSpanId: string | null;
  viewMode: DrawerViewMode;
  vizTab: VizTab;
  activeTab: DrawerTab;

  eventsExpanded: boolean;
  evalsExpanded: boolean;
  conversationExpanded: boolean;

  traceBackStack: TraceHistoryEntry[];

  openTrace: (traceId: string) => void;
  closeDrawer: () => void;
  toggleTrace: (traceId: string) => void;
  selectSpan: (spanId: string) => void;
  clearSpan: () => void;
  setViewMode: (mode: DrawerViewMode) => void;
  setVizTab: (tab: VizTab) => void;
  setActiveTab: (tab: DrawerTab) => void;
  toggleMaximized: () => void;
  toggleAccordion: (section: "events" | "evals" | "conversation") => void;
  pushTraceHistory: (entry: TraceHistoryEntry) => void;
  popTraceHistory: () => TraceHistoryEntry | null;
  clearTraceHistory: () => void;
}

export const useDrawerStore = create<DrawerState>((set, get) => ({
  isOpen: false,
  isMaximized: false,
  traceId: null,
  selectedSpanId: null,
  viewMode: "trace",
  vizTab: "waterfall",
  activeTab: "summary",
  eventsExpanded: false,
  evalsExpanded: false,
  conversationExpanded: false,

  traceBackStack: [],

  openTrace: (traceId) =>
    set({
      isOpen: true,
      traceId,
      selectedSpanId: null,
      activeTab: "summary",
    }),

  closeDrawer: () =>
    set({
      isOpen: false,
      isMaximized: false,
      traceId: null,
      selectedSpanId: null,
      traceBackStack: [],
    }),

  toggleTrace: (traceId) =>
    set((s) => {
      if (s.isOpen && s.traceId === traceId) {
        return { isOpen: false, traceId: null, selectedSpanId: null };
      }
      return {
        isOpen: true,
        traceId,
        selectedSpanId: null,
        activeTab: "summary" as const,
      };
    }),

  selectSpan: (spanId) =>
    set({ selectedSpanId: spanId, activeTab: "span" }),

  clearSpan: () =>
    set({ selectedSpanId: null, activeTab: "summary" }),

  setViewMode: (mode) => set({ viewMode: mode }),
  setVizTab: (tab) => set({ vizTab: tab }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleMaximized: () => set((s) => ({ isMaximized: !s.isMaximized })),

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
      if (top && top.traceId === entry.traceId && top.viewMode === entry.viewMode) {
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

  clearTraceHistory: () => set({ traceBackStack: [] }),
}));
