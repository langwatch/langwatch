import { IconButton } from "@chakra-ui/react";
import { Keyboard } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";
import { useUIStore } from "../../stores/uiStore";

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
