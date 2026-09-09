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
        // Tall enough to read as somewhere you write a message rather than a
        // search field, and it grows from there. The height is the field's own
        // now — what used to make the box look empty was an absolutely
        // positioned button sitting in a flex row below it that held nothing.
        minHeight="72px"
        maxHeight="240px"
        autoresize
        flex={1}
        minWidth={0}
        paddingX={3}
        paddingTop={3}
        paddingBottom={1}
        fontSize="sm"
        lineHeight="1.5"
        border="none"
        background="transparent"
        // Block, not the default inline-block: the baseline descender under an
        // inline-block textarea is a phantom few pixels of gap beneath the text.
        display="block"
        _focus={{ outline: "none", boxShadow: "none" }}
        // The ring belongs to the card around it, not to the field.
        _focusVisible={{ outline: "none", boxShadow: "none" }}
      />
    );
  },
);

ChatTextArea.displayName = "ChatTextArea";
