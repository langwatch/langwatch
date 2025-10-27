import { Textarea, type TextareaProps } from "@chakra-ui/react";

import { forwardRef } from "react";

export interface ChatTextAreaProps extends TextareaProps {
  inProgress: boolean;
}

export const ChatTextArea = forwardRef<HTMLTextAreaElement, ChatTextAreaProps>(
  ({ inProgress, ...props }, ref) => {
    return (
      <Textarea
        {...props}
        ref={ref}
        placeholder="Type your message here. Shift+Enter for new line."
        disabled={inProgress}
        resize="none"
        rows={1}
        minHeight="40px"
        maxHeight="200px"
        paddingY={3}
        border="none"
        outline="none"
        _focus={{ boxShadow: "none" }}
        _disabled={{ opacity: 0.6, cursor: "not-allowed" }}
      />
    );
  },
);

ChatTextArea.displayName = "ChatTextArea";
