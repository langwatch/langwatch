import type {
  SpanTreeNode,
  TraceHeader,
} from "~/server/api/routers/tracesV2.schemas";
import type { useDrawerStore } from "../stores/drawerStore";
import type { useTraceDrawerNavigation } from "./useTraceDrawerNavigation";

type DrawerStoreState = ReturnType<typeof useDrawerStore.getState>;

export type ShortcutGroupTitle =
  | "View"
  | "Visualisation"
  | "Navigation"
  | "Actions"
  | "Help";

export interface ShortcutContext {
  event: KeyboardEvent;
  store: DrawerStoreState;
  trace: TraceHeader;
  spanTree: SpanTreeNode[];
  nextTraceId: string | null;
  nextTimestamp: number | undefined;
  prevTraceId: string | null;
  prevTimestamp: number | undefined;
  navigateToTrace: ReturnType<
    typeof useTraceDrawerNavigation
  >["navigateToTrace"];
  goBack: () => void;
  canGoBack: boolean;
  refreshActiveTrace: () => Promise<void> | void;
  onClose: () => void;
}

export interface ShortcutEntry {
  /** Keys recognised by `KeyboardEvent.key`. Letter shortcuts list both cases. */
  matchKeys: string[];
  /** Keys rendered in the help dialog (single canonical form). */
  displayKeys: string[];
  group: ShortcutGroupTitle;
  description: string;
  detail?: string;
  /** When false, the entry is silently skipped (no preventDefault, no run). */
  guard?: (ctx: ShortcutContext) => boolean;
  run: (ctx: ShortcutContext) => void;
}

export const TRACE_DRAWER_SHORTCUTS: ShortcutEntry[] = [
  {
    matchKeys: ["Escape"],
    displayKeys: ["Esc"],
    group: "View",
    description: "Close drawer / span",
    run: ({ store, onClose }) => {
      if (store.shortcutsOpen) {
        store.setShortcutsOpen(false);
      } else if (store.selectedSpanId) {
        store.clearSpan();
      } else {
        onClose();
      }
    },
  },
  {
    matchKeys: ["?"],
    displayKeys: ["?"],
    group: "Help",
    description: "Show this help",
    run: ({ store }) => {
      store.setShortcutsOpen(!store.shortcutsOpen);
    },
  },
  {
    matchKeys: ["ArrowRight"],
    displayKeys: ["→"],
    group: "Navigation",
    description: "Next trace in conversation",
    run: ({ store, trace, nextTraceId, nextTimestamp, navigateToTrace }) => {
      if (!nextTraceId) return;
      navigateToTrace({
        fromTraceId: trace.traceId,
        fromViewMode: store.viewMode,
        toTraceId: nextTraceId,
        toTimestamp: nextTimestamp,
      });
    },
  },
  {
    matchKeys: ["ArrowLeft"],
    displayKeys: ["←"],
    group: "Navigation",
    description: "Previous trace in conversation",
    run: ({ store, trace, prevTraceId, prevTimestamp, navigateToTrace }) => {
      if (!prevTraceId) return;
      navigateToTrace({
        fromTraceId: trace.traceId,
        fromViewMode: store.viewMode,
        toTraceId: prevTraceId,
        toTimestamp: prevTimestamp,
      });
    },
  },
  {
    matchKeys: ["]"],
    displayKeys: ["]"],
    group: "Navigation",
    description: "Next span",
    guard: ({ spanTree }) => spanTree.length > 0,
    run: ({ store, spanTree }) => {
      const idx = store.selectedSpanId
        ? spanTree.findIndex((s) => s.spanId === store.selectedSpanId)
        : -1;
      const next = spanTree[Math.min(idx + 1, spanTree.length - 1)];
      if (next) store.selectSpan(next.spanId);
    },
  },
  {
    matchKeys: ["["],
    displayKeys: ["["],
    group: "Navigation",
    description: "Previous span",
    guard: ({ spanTree }) => spanTree.length > 0,
    run: ({ store, spanTree }) => {
      const idx = store.selectedSpanId
        ? spanTree.findIndex((s) => s.spanId === store.selectedSpanId)
        : 0;
      const prev = spanTree[Math.max(idx - 1, 0)];
      if (prev) store.selectSpan(prev.spanId);
    },
  },
  {
    matchKeys: ["b", "B"],
    displayKeys: ["B"],
    group: "Navigation",
    description: "Back to previous trace",
    guard: ({ canGoBack }) => canGoBack,
    run: ({ goBack }) => goBack(),
  },
  {
    matchKeys: ["1"],
    displayKeys: ["1"],
    group: "Visualisation",
    description: "Waterfall",
    run: ({ store }) => store.setVizTab("waterfall"),
  },
  {
    matchKeys: ["2"],
    displayKeys: ["2"],
    group: "Visualisation",
    description: "Topology",
    run: ({ store }) => store.setVizTab("topology"),
  },
  {
    matchKeys: ["3"],
    displayKeys: ["3"],
    group: "Visualisation",
    description: "Sequence diagram",
    run: ({ store }) => store.setVizTab("sequence"),
  },
  {
    // O used to jump to the trace Summary tab inside SpanTabBar. The
    // tab moved to the ModeSwitch (Trace | Summary | Conversation), so
    // O now swaps the drawer mode — same destination, different chrome.
    matchKeys: ["o", "O"],
    displayKeys: ["O"],
    group: "Navigation",
    description: "Trace summary",
    run: ({ store }) => store.setViewMode("summary"),
  },
  // L (LLM-Optimized tab) and P (Prompts tab) shortcuts retired in the
  // span-detail redesign. The LLM and Prompts views are now selected
  // automatically based on the selected span's kind — there's no
  // user-facing toggle to bind a shortcut to.
  {
    matchKeys: ["t", "T"],
    displayKeys: ["T"],
    group: "View",
    description: "Trace view",
    run: ({ store }) => store.setViewMode("trace"),
  },
  {
    matchKeys: ["c", "C"],
    displayKeys: ["C"],
    group: "View",
    description: "Conversation view",
    guard: ({ trace }) => Boolean(trace.conversationId),
    run: ({ store }) => store.setViewMode("conversation"),
  },
  {
    matchKeys: ["m", "M"],
    displayKeys: ["M"],
    group: "View",
    description: "Maximize / restore",
    run: ({ store }) => {
      if (typeof window === "undefined") {
        store.toggleMaximized();
        return;
      }
      // The maximize gesture now drives the same width snap that
      // double-clicking the edge grip uses — the boolean `isMaximized`
      // is still updated for components that show a Maximize/Restore
      // icon label, but the actual size change comes from `widthPx`.
      store.toggleSnapMaximize(window.innerWidth);
    },
  },
  {
    matchKeys: ["r", "R"],
    displayKeys: ["R"],
    group: "Actions",
    description: "Refresh trace",
    run: ({ refreshActiveTrace }) => {
      void refreshActiveTrace();
    },
  },
  {
    matchKeys: ["y", "Y"],
    displayKeys: ["Y"],
    group: "Actions",
    description: "Copy trace ID",
    run: ({ trace }) => {
      void navigator.clipboard.writeText(trace.traceId);
    },
  },
];

export interface HelpGroup {
  title: ShortcutGroupTitle;
  items: Array<{ keys: string[]; label: string; detail?: string }>;
}

const HELP_GROUP_ORDER: ShortcutGroupTitle[] = [
  "View",
  "Visualisation",
  "Navigation",
  "Actions",
  "Help",
];

/**
 * Drawer help-dialog groups derived from `TRACE_DRAWER_SHORTCUTS`. The "raw
 * JSON" entry is included here even though it isn't a global shortcut — it's
 * a contextual key handled by IOViewer when focused.
 */
export const TRACE_DRAWER_HELP_GROUPS: HelpGroup[] = HELP_GROUP_ORDER.map(
  (title) => ({
    title,
    items: TRACE_DRAWER_SHORTCUTS.filter((s) => s.group === title).map((s) => ({
      keys: s.displayKeys,
      label: s.description,
      detail: s.detail,
    })),
  }),
)
  .map((g) =>
    g.title === "Actions"
      ? {
          ...g,
          items: [...g.items, { keys: ["\\"], label: "View raw JSON" }],
        }
      : g,
  )
  .filter((g) => g.items.length > 0);
