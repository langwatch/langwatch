import { Textarea, type TextareaProps } from "@chakra-ui/react";

import { forwardRef } from "react";

export interface ChatTextAreaProps extends TextareaProps {
  inProgress: boolean;
}

/**
 * A chat-specific textarea component with auto-growing height.
 *
 * Single Responsibility: Provides a styled, accessible textarea for chat message input
 * with automatic height adjustment. Stays enabled during message processing so users
 * can continue typing their next message.
 *
 * @param inProgress - Currently unused, kept for API compatibility
 * @param props - Standard Chakra UI Textarea props
 * @param ref - Forwarded ref to the underlying textarea element
 */
export const ChatTextArea = forwardRef<HTMLTextAreaElement, ChatTextAreaProps>(
  ({ inProgress: _inProgress, ...props }, ref) => {
    return (
      <Textarea
        {...props}
        ref={ref}
        placeholder="Type your message here. Shift+Enter for new line."
        resize="none"
        rows={1}
        minHeight="60px"
        maxHeight="300px"
        autoresize
        border="none"
        outline="none"
      />
    );
  },
);

ChatTextArea.displayName = "ChatTextArea";
