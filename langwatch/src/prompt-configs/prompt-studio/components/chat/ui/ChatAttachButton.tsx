import { Box, Icon, type BoxProps } from "@chakra-ui/react";
import { LuPaperclip } from "react-icons/lu";

/**
 * Attach button for file uploads in chat input.
 * Single Responsibility: Renders a clickable attachment icon.
 */
export interface ChatAttachButtonProps extends BoxProps {
  /** Click handler for attachment action (undefined if disabled) */
  onAttach?: () => void;
}

export function ChatAttachButton({
  onAttach,
  ...boxProps
}: ChatAttachButtonProps) {
  /**
   * handleKeyDown
   * Single Responsibility: Triggers attachment action on keyboard interaction (Enter/Space).
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onAttach && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onAttach();
    }
  };

  return (
    <Box
      role="button"
      aria-label="Attach file"
      aria-disabled={!onAttach}
      tabIndex={onAttach ? 0 : undefined}
      color="fg.muted"
      cursor={onAttach ? "pointer" : "default"}
      onClick={onAttach ? onAttach : undefined}
      onKeyDown={handleKeyDown}
      _hover={onAttach ? { color: "fg.emphasized" } : undefined}
      {...boxProps}
    >
      <Icon as={LuPaperclip} boxSize="18px" />
    </Box>
  );
}
