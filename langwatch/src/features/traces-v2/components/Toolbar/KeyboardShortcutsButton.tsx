import { IconButton } from "@chakra-ui/react";
import { Keyboard } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
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

export const KeyboardShortcutsButton = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip content="Keyboard shortcuts" positioning={{ placement: "bottom" }}>
        <IconButton
          size="xs"
          variant="ghost"
          color="fg.subtle"
          aria-label="Keyboard shortcuts"
          onClick={() => setOpen(true)}
        >
          <Keyboard size={14} />
        </IconButton>
      </Tooltip>
      <KeyboardShortcutsHelp
        open={open}
        onClose={() => setOpen(false)}
        groups={PAGE_GROUPS}
      />
    </>
  );
};
