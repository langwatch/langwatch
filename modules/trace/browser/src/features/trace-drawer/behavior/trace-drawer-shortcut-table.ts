import type { ShortcutDefinition } from "@langwatch/design-system/shortcut-hint";
import type { SpanTreeNode, TraceHeader } from "@langwatch/trace-contract";

import type { TraceDrawerState } from "../../../behavior/trace-drawer.ts";
import { isTerminalOrigin } from "../../../model/terminal-origin.ts";
import type { useTraceDrawerNavigation } from "./use-trace-drawer-navigation.ts";

type ShortcutGroupTitle = "View" | "Visualisation" | "Navigation" | "Actions" | "Help";

export interface ShortcutContext {
  event: KeyboardEvent;
  store: TraceDrawerState;
  trace: TraceHeader;
  spanTree: SpanTreeNode[];
  nextTraceId: string | null;
  nextTimestamp: number | undefined;
  prevTraceId: string | null;
  prevTimestamp: number | undefined;
  navigateToTrace: ReturnType<typeof useTraceDrawerNavigation>["navigateToTrace"];
  goBack: () => void;
  canGoBack: boolean;
  refreshActiveTrace: () => Promise<void> | void;
  onClose: () => void;
}

export type TraceDrawerShortcutId = (typeof SHORTCUT_IDS)[number];

const SHORTCUT_IDS = [
  "close",
  "help",
  "next-trace",
  "previous-trace",
  "next-span",
  "previous-span",
  "back",
  "waterfall",
  "flame",
  "topology",
  "sequence",
  "summary",
  "trace",
  "conversation",
  "session",
  "terminal",
  "maximize",
  "refresh",
  "copy-trace-id",
] as const;

interface ShortcutEntry {
  /** Stable name so hints and the help list read the same definition. */
  id: TraceDrawerShortcutId;
  /** Keys recognised by `KeyboardEvent.key`. Letter shortcuts list both cases. */
  matchKeys: string[];
  group: ShortcutGroupTitle;
  description: string;
  detail?: string;
  /** When false, the entry is silently skipped (no preventDefault, no run). */
  guard?: (ctx: ShortcutContext) => boolean;
  run: (ctx: ShortcutContext) => void;
}

export const TRACE_DRAWER_SHORTCUTS: ShortcutEntry[] = [
  {
    id: "close",
    matchKeys: ["Escape"],
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
    id: "help",
    matchKeys: ["?"],
    group: "Help",
    description: "Show this help",
    run: ({ store }) => {
      store.setShortcutsOpen(!store.shortcutsOpen);
    },
  },
  {
    id: "next-trace",
    matchKeys: ["ArrowRight"],
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
    id: "previous-trace",
    matchKeys: ["ArrowLeft"],
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
    id: "next-span",
    matchKeys: ["]"],
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
    id: "previous-span",
    matchKeys: ["["],
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
    id: "back",
    matchKeys: ["b", "B"],
    group: "Navigation",
    description: "Back to previous trace",
    guard: ({ canGoBack }) => canGoBack,
    run: ({ goBack }) => goBack(),
  },
  {
    id: "waterfall",
    matchKeys: ["1"],
    group: "Visualisation",
    description: "Waterfall",
    run: ({ store }) => store.setVizTab("waterfall"),
  },
  {
    id: "flame",
    matchKeys: ["2"],
    group: "Visualisation",
    description: "Flame graph",
    run: ({ store }) => store.setVizTab("flame"),
  },
  {
    id: "topology",
    matchKeys: ["3"],
    group: "Visualisation",
    description: "Topology",
    run: ({ store }) => store.setVizTab("topology"),
  },
  {
    id: "sequence",
    matchKeys: ["4"],
    group: "Visualisation",
    description: "Sequence diagram",
    run: ({ store }) => store.setVizTab("sequence"),
  },
  {
    // O used to jump to the trace Summary tab inside SpanTabBar. The
    // tab moved to the ModeSwitch (Trace | Summary | Conversation), so
    // O now swaps the drawer mode — same destination, different chrome.
    id: "summary",
    matchKeys: ["o", "O"],
    group: "Navigation",
    description: "Trace summary",
    run: ({ store }) => store.setViewMode("summary"),
  },
  // L (LLM-Optimized tab) and P (Prompts tab) shortcuts retired in the
  // span-detail redesign. The LLM and Prompts views are now selected
  // automatically based on the selected span's kind — there's no
  // user-facing toggle to bind a shortcut to.
  {
    id: "trace",
    matchKeys: ["t", "T"],
    group: "View",
    description: "Trace view",
    run: ({ store }) => store.setViewMode("trace"),
  },
  {
    id: "conversation",
    matchKeys: ["c", "C"],
    group: "View",
    description: "Conversation view",
    guard: ({ trace }) => Boolean(trace.conversationId),
    run: ({ store }) => store.setViewMode("conversation"),
  },
  // Session + Terminal exist only for coding-agent traces, so both are guarded
  // on the same signal the tabs are (`isTerminalOrigin`) — an unguarded S would
  // strand an ordinary LLM trace on a mode it has no tab for.
  {
    id: "session",
    matchKeys: ["s", "S"],
    group: "View",
    description: "Session overview",
    guard: ({ trace }) =>
      isTerminalOrigin({
        serviceName: trace.serviceName,
        origin: trace.origin,
      }),
    run: ({ store }) => store.setViewMode("session"),
  },
  {
    id: "terminal",
    matchKeys: ["e", "E"],
    group: "View",
    description: "Terminal replay",
    guard: ({ trace }) =>
      isTerminalOrigin({
        serviceName: trace.serviceName,
        origin: trace.origin,
      }),
    run: ({ store }) => store.setViewMode("terminal"),
  },
  {
    id: "maximize",
    matchKeys: ["m", "M"],
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
    id: "refresh",
    matchKeys: ["r", "R"],
    group: "Actions",
    description: "Refresh trace",
    run: ({ refreshActiveTrace }) => {
      void refreshActiveTrace();
    },
  },
  {
    id: "copy-trace-id",
    matchKeys: ["y", "Y"],
    group: "Actions",
    description: "Copy trace ID",
    run: ({ trace }) => {
      void navigator.clipboard.writeText(trace.traceId);
    },
  },
];

export interface ShortcutHelpItem {
  label: string;
  /** Absent for a pointer gesture that is not a key. */
  shortcut?: ShortcutDefinition;
  gesture?: string;
  detail?: string;
  /** Where the key works, e.g. "When the span tabs are focused". */
  scope?: string;
}

export interface ShortcutHelpGroup {
  title: string;
  items: ShortcutHelpItem[];
}

/** One chord per distinct key; letter shortcuts list both cases but show one. */
function definitionFor(entry: ShortcutEntry): ShortcutDefinition {
  const keys = [
    ...new Set(entry.matchKeys.map((key) => (key.length === 1 ? key.toLowerCase() : key))),
  ];
  const [first, ...rest] = keys.map((key) => ({ keys: [key] as const }));
  return { alternatives: [first as { keys: readonly [string] }, ...rest] };
}

/** The hint and ARIA definition for a drawer shortcut, derived from the live table. */
export function drawerShortcut(id: TraceDrawerShortcutId): ShortcutDefinition {
  const entry = TRACE_DRAWER_SHORTCUTS.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`No drawer shortcut named ${id}`);
  return definitionFor(entry);
}

/** Raw JSON is a drawer-header listener, live whenever the drawer is: not an IO-view key. */
export const RAW_JSON_SHORTCUT: ShortcutDefinition = { alternatives: [{ keys: ["\\"] }] };

const HELP_GROUP_ORDER: ShortcutGroupTitle[] = [
  "View",
  "Visualisation",
  "Navigation",
  "Actions",
  "Help",
];

/** Drawer help groups derived from `TRACE_DRAWER_SHORTCUTS`, plus the header's raw JSON key. */
export const TRACE_DRAWER_HELP_GROUPS: ShortcutHelpGroup[] = HELP_GROUP_ORDER.map((title) => ({
  title,
  items: TRACE_DRAWER_SHORTCUTS.filter((s) => s.group === title).map((s) => ({
    label: s.description,
    shortcut: definitionFor(s),
    detail: s.detail,
  })),
}))
  .map((g) =>
    g.title === "Actions"
      ? { ...g, items: [...g.items, { label: "View raw JSON", shortcut: RAW_JSON_SHORTCUT }] }
      : g,
  )
  .filter((g) => g.items.length > 0);
