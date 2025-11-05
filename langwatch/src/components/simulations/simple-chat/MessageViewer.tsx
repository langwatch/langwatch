import { VStack } from "@chakra-ui/react";
import type { MessageViewerProps } from "./types";
import { MessageItem } from "./MessageItem";

/**
 * Renders a list of chat messages
 * Single Responsibility: Map messages array to MessageItem components
 */
export function MessageViewer({ messages, smallerView }: MessageViewerProps) {
  return (
    <VStack gap={4} align="stretch" width="full">
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          smallerView={smallerView}
        />
      ))}
    </VStack>
  );
}
