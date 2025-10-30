import { Box, type BoxProps } from "@chakra-ui/react";
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
  return (
    <Box
      color="gray.500"
      cursor={onAttach ? "pointer" : "default"}
      onClick={onAttach}
      _hover={onAttach ? { color: "gray.700" } : undefined}
      {...boxProps}
    >
      <Paperclip size={18} />
    </Box>
  );
}

