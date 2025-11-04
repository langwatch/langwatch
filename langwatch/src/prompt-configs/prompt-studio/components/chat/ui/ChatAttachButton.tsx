import { Box, Icon, type BoxProps } from "@chakra-ui/react";
import { Paperclip } from "react-feather";

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
      <Icon as={Paperclip} boxSize="18px" />
    </Box>
  );
}
