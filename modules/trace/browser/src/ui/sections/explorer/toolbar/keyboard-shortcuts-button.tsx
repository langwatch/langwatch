import { IconButton } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useUIStore } from "@langwatch/trace-browser-kit";
import { Keyboard } from "lucide-react";

export const KeyboardShortcutsButton = () => {
  const toggle = useUIStore((s) => s.toggleShortcutsHelp);

  return (
    <Tooltip content="Keyboard shortcuts" positioning={{ placement: "bottom" }}>
      <IconButton
        size="xs"
        variant="ghost"
        color="fg.subtle"
        aria-label="Keyboard shortcuts"
        onClick={toggle}
      >
        <Keyboard size={14} />
      </IconButton>
    </Tooltip>
  );
};
