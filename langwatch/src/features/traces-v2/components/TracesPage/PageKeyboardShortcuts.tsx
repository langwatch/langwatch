import { useUIStore } from "../../stores/uiStore";
import {
  KeyboardShortcutsHelp,
  type ShortcutGroup,
} from "../TraceDrawer/KeyboardShortcutsHelp";

const PAGE_GROUPS: ShortcutGroup[] = [
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

  return (
    <KeyboardShortcutsHelp
      open={open}
      onClose={() => setOpen(false)}
      groups={PAGE_GROUPS}
    />
  );
};
