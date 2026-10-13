import type { ShortcutDefinition } from "@langwatch/design-system/shortcut-hint";
import { useMemo } from "react";

import { useUIStore } from "../../../../behavior/ui.store.ts";
import { useAskLangyFromSearch } from "../search-bar/use-ask-langy-from-search.ts";
import {
  KeyboardShortcutsHelp,
  type ShortcutGroup,
} from "../trace-drawer/keyboard-shortcuts-help.tsx";

const single = (key: string): ShortcutDefinition => ({ alternatives: [{ keys: [key] }] });
const modKey = (key: string): ShortcutDefinition => ({
  alternatives: [{ keys: ["Control", key] }, { keys: ["Meta", key] }],
});

/** The page's existing shortcuts, read by the toolbar hints and by the help list alike. */
export const PAGE_SHORTCUTS = {
  sidebar: single("["),
  focusSearch: single("/"),
  find: modKey("f"),
  help: single("?"),
  ask: modKey("i"),
  density: single("d"),
  configureFacets: single("c"),
  expandAll: single("e"),
  clearFilters: single("x"),
  resetLens: single("r"),
} as const;

const FIND_FIELD = "While the find field is focused";
const SIDEBAR_FOCUS = "Paused while the drawer is open or you are typing";

// ⌘I fires the search bar's ask affordance, which belongs to Langy when
// Langy is available — so the list names whoever will actually answer.
const pageGroups = (askShortcutLabel: string): ShortcutGroup[] => [
  {
    title: "Navigation",
    items: [
      { shortcut: PAGE_SHORTCUTS.sidebar, label: "Toggle filter sidebar" },
      { shortcut: PAGE_SHORTCUTS.focusSearch, label: "Focus search" },
      { shortcut: PAGE_SHORTCUTS.find, label: "Find in loaded traces" },
      { shortcut: PAGE_SHORTCUTS.help, label: "Show this help" },
    ],
  },
  {
    title: "Find in loaded traces",
    items: [
      {
        label: "Next match",
        shortcut: { alternatives: [{ keys: ["Enter"] }, { keys: ["ArrowDown"] }] },
        scope: FIND_FIELD,
      },
      {
        label: "Previous match",
        shortcut: { alternatives: [{ keys: ["Shift", "Enter"] }, { keys: ["ArrowUp"] }] },
        scope: FIND_FIELD,
      },
      { label: "Close find", shortcut: single("Escape"), scope: FIND_FIELD },
    ],
  },
  {
    // Was a separate lightbulb popover next to the search bar; folded in
    // here so search tips live with every other shortcut.
    title: "Search",
    items: [
      {
        shortcut: PAGE_SHORTCUTS.ask,
        label: askShortcutLabel,
        detail: "Describe what you want in plain English",
      },
      {
        gesture: "Shift + click",
        label: "Add a facet to the query with OR instead of AND",
        detail: "⌘ / Ctrl + click a facet does the same",
      },
      {
        gesture: "Click",
        label: "Click an operator in the query to flip it in place",
        detail: "AND and OR",
      },
    ],
  },
  {
    title: "View",
    items: [
      {
        shortcut: PAGE_SHORTCUTS.density,
        label: "Toggle density",
        detail: "Compact ↔ Comfortable, saved on this device",
      },
    ],
  },
  {
    title: "Filter sidebar",
    items: [
      {
        shortcut: PAGE_SHORTCUTS.configureFacets,
        label: "Configure which facets show",
        scope: SIDEBAR_FOCUS,
      },
      {
        shortcut: PAGE_SHORTCUTS.expandAll,
        label: "Expand or collapse all sections",
        scope: SIDEBAR_FOCUS,
      },
      { shortcut: PAGE_SHORTCUTS.clearFilters, label: "Clear all filters", scope: SIDEBAR_FOCUS },
      {
        shortcut: PAGE_SHORTCUTS.resetLens,
        label: "Reset to the current lens",
        scope: SIDEBAR_FOCUS,
      },
      { shortcut: single("Tab"), label: "Move between sections and rows" },
      {
        shortcut: single(" "),
        label: "Toggle a facet",
        scope: "When a facet row is focused",
      },
      {
        shortcut: { alternatives: [{ keys: ["Shift", "Enter"] }] },
        label: "Expand or collapse all sections",
        scope: "When a section header is focused",
      },
    ],
  },
  {
    title: "Reorder sections",
    items: [
      {
        shortcut: single(" "),
        label: "Pick up section or drop it in its new position",
        scope: "When a drag handle is focused",
      },
      {
        shortcut: { alternatives: [{ keys: ["ArrowUp"] }, { keys: ["ArrowDown"] }] },
        label: "Move picked-up section",
      },
      { shortcut: single("Escape"), label: "Cancel reorder" },
    ],
  },
  {
    title: "Trace list",
    items: [
      {
        shortcut: { alternatives: [{ keys: ["ArrowUp"] }, { keys: ["ArrowDown"] }] },
        label: "Move between rows",
        scope: "When the trace list is focused",
      },
      {
        shortcut: single("Enter"),
        label: "Open or close the trace",
        scope: "When a row is focused",
      },
      { shortcut: single("p"), label: "Toggle peek", scope: "When the trace list is focused" },
      {
        shortcut: single("Escape"),
        label: "Close the trace",
        scope: "When the trace list is focused",
      },
    ],
  },
];

export const PageKeyboardShortcuts: React.FC = () => {
  const open = useUIStore((s) => s.shortcutsHelpOpen);
  const setOpen = useUIStore((s) => s.setShortcutsHelpOpen);
  const { langyRoutesAsk } = useAskLangyFromSearch();
  const groups = useMemo(
    () => pageGroups(langyRoutesAsk ? "Ask Langy about these traces" : "Ask AI to build a query"),
    [langyRoutesAsk],
  );

  return (
    <KeyboardShortcutsHelp
      open={open}
      onClose={() => setOpen(false)}
      groups={groups}
      fallbackFocusSelector='[data-testid="trace-toolbar-shortcuts"]'
    />
  );
};
