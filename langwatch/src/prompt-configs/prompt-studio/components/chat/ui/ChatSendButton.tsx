import { Box, type BoxProps } from "@chakra-ui/react";
import { Send } from "react-feather";

/**
 * Send button for chat input with disabled state handling.
 * Single Responsibility: Renders a clickable send button with visual feedback.
 */
export interface ChatSendButtonProps extends BoxProps {
  /** Whether the button is disabled (in progress or empty input) */
  disabled?: boolean;
  /** Click handler for send action */
  onSend: () => void;
}

export function ChatSendButton({
  disabled = false,
  onSend,
  ...boxProps
}: ChatSendButtonProps) {
  return (
    <Box
      cursor={disabled ? "not-allowed" : "pointer"}
      onClick={disabled ? undefined : onSend}
      bg={disabled ? "gray.300" : "orange.500"}
      color="white"
      borderRadius="md"
      padding={2}
      display="flex"
      alignItems="center"
      justifyContent="center"
      opacity={disabled ? 0.5 : 1}
      _hover={disabled ? undefined : { bg: "orange.600" }}
      transition="all 0.2s"
      {...boxProps}
    >
      <Send size={16} />
    </Box>
  );
}

