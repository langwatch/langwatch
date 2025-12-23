import { Button, type ButtonProps, Icon } from "@chakra-ui/react";
import { LuSend } from "react-icons/lu";

/**
 * Send button for chat input with disabled state handling.
 * Single Responsibility: Renders a clickable send button with visual feedback.
 */
export interface ChatSendButtonProps extends Omit<ButtonProps, "onClick"> {
  /** Whether the button is disabled (in progress or empty input) */
  disabled?: boolean;
  /** Click handler for send action */
  onSend: () => void;
}

/**
 * Send button for chat input with disabled state handling.
 */
export function ChatSendButton({
  disabled = false,
  onSend,
  ...buttonProps
}: ChatSendButtonProps) {
  return (
    <Button
      type="button"
      unstyled
      cursor={disabled ? "not-allowed" : "pointer"}
      onClick={() => onSend()}
      disabled={disabled}
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
      {...buttonProps}
    >
      <Icon as={LuSend} boxSize="16px" />
    </Button>
  );
}
