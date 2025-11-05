import { Box } from "@chakra-ui/react";
import type { MessageViewerProps } from "./types";
import { MessageViewer } from "./MessageViewer";

/**
 * Minimal, performant chat UI component
 * Single Responsibility: Provide container and layout for message viewer
 */
export function SimpleChatUI({ messages, smallerView }: MessageViewerProps) {
  return (
    <Box width="full" height="full">
      <MessageViewer messages={messages} smallerView={smallerView} />
    </Box>
  );
}

