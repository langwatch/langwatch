import { useMemo } from "react";
import { LuSearch } from "react-icons/lu";
import { useUIStore } from "../../stores/uiStore";
import { useAskLangyFromSearch } from "../SearchBar/useAskLangyFromSearch";
import {
  KeyboardShortcutsHelp,
  type ShortcutGroup,
} from "../TraceDrawer/KeyboardShortcutsHelp";

// ⌘I fires the search bar's ask affordance, which belongs to Langy when
// Langy is available — so the dialog names whoever will actually answer.
const pageGroups = (askShortcutLabel: string): ShortcutGroup[] => [
  {
    title: "Navigation",
    items: [
      { keys: ["["], label: "Toggle filter sidebar" },
      { keys: ["/"], label: "Focus search" },
      { keys: ["⌘ / Ctrl", "F"], label: "Find in loaded traces" },
      { keys: ["?"], label: "Show this help" },
    ],
  },
  {
    // Was a separate lightbulb popover next to the search bar; folded in
    // here so search tips live with every other shortcut.
    title: "Search",
    icon: LuSearch,
    accent: "purple",
    items: [
      {
        keys: ["⌘ / Ctrl", "I"],
        label: askShortcutLabel,
        detail: "Describe what you want in plain English",
      },
      {
        keys: ["Shift", "click"],
        label: "Add a facet to the query with OR instead of AND",
        detail: "⌘ / Ctrl + click a facet does the same",
      },
      {
        keys: ["AND / OR"],
        label: "Click an operator in the query to flip it in place",
      },
    ],
  },
  {
    title: "View",
    items: [
      {
        keys: ["D"],
        label: "Toggle density",
        detail: "Compact ↔ Comfortable, saved on this device",
      },
    ],
  },
  {
    title: "Filter sidebar",
    items: [
      { keys: ["C"], label: "Configure which facets show" },
      { keys: ["E"], label: "Expand or collapse all sections" },
      { keys: ["X"], label: "Clear all filters" },
      { keys: ["R"], label: "Reset to the current lens" },
      { keys: ["Tab"], label: "Move between sections and rows" },
      { keys: ["Space"], label: "Toggle a facet (when row focused)" },
      {
        keys: ["Shift", "Enter"],
        label: "Expand or collapse all sections",
      },
    ],
  },
  {
    title: "Reorder sections",
    items: [
      { keys: ["Space"], label: "Pick up section (drag handle focused)" },
      { keys: ["↑", "↓"], label: "Move picked-up section" },
      { keys: ["Space"], label: "Drop section in new position" },
      { keys: ["Esc"], label: "Cancel reorder" },
    ],
  },
];

export const PageKeyboardShortcuts: React.FC = () => {
  const open = useUIStore((s) => s.shortcutsHelpOpen);
  const setOpen = useUIStore((s) => s.setShortcutsHelpOpen);
  const { langyRoutesAsk } = useAskLangyFromSearch();
  const groups = useMemo(
    () =>
      pageGroups(
        langyRoutesAsk ? "Ask Langy about these traces" : "Ask AI to build a query",
      ),
    [langyRoutesAsk],
  );

  return (
    <KeyboardShortcutsHelp
      open={open}
      onClose={() => setOpen(false)}
      groups={groups}
    />
  );
};
