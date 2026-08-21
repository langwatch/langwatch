import { Button, type ButtonProps, Icon } from "@chakra-ui/react";
import { LuSend, LuSquare } from "react-icons/lu";

const BUTTON_STATES = {
  disabled: {
    label: "Send message",
    background: "bg.emphasized",
    hoverBackground: undefined,
    icon: LuSend,
  },
  send: {
    label: "Send message",
    background: "orange.solid",
    hoverBackground: "orange.emphasized",
    icon: LuSend,
  },
  stop: {
    label: "Stop generating",
    background: "red.solid",
    hoverBackground: "red.emphasized",
    icon: LuSquare,
  },
} as const;

/**
 * Send button for chat input with disabled state handling.
 * Single Responsibility: Renders a clickable send button with visual feedback.
 */
export interface ChatSendButtonProps extends Omit<ButtonProps, "onClick"> {
  /** A run is in flight: the button stops it instead of sending. */
  inProgress?: boolean;
  /** Whether the button is disabled (in progress or empty input) */
  disabled?: boolean;
  /** Click handler for send action */
  onSend: () => void;
  /** Cancels the run in flight. */
  onStop?: () => void;
}

/**
 * Send button for chat input with disabled state handling.
 */
export function ChatSendButton({
  inProgress = false,
  disabled = false,
  onSend,
  onStop,
  ...buttonProps
}: ChatSendButtonProps) {
  const stopping = inProgress && !!onStop;
  const inactive = stopping ? false : disabled || inProgress;
  const state = stopping ? "stop" : inactive ? "disabled" : "send";
  const buttonState = BUTTON_STATES[state];
  const handleClick = stopping ? onStop : onSend;

  return (
    <Button
      type="button"
      unstyled
      aria-label={buttonState.label}
      cursor={inactive ? "not-allowed" : "pointer"}
      onClick={handleClick}
      disabled={inactive}
      bg={buttonState.background}
      color="white"
      borderRadius="md"
      padding={2}
      display="flex"
      alignItems="center"
      justifyContent="center"
      opacity={inactive ? 0.5 : 1}
      _hover={
        buttonState.hoverBackground
          ? { bg: buttonState.hoverBackground }
          : undefined
      }
      transition="all 0.2s"
      {...buttonProps}
    >
      <Icon as={buttonState.icon} boxSize="16px" />
    </Button>
  );
}
