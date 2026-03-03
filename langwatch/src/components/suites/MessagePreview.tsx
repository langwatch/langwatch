/**
 * Lightweight chat message preview for grid cards.
 *
 * Renders scenario messages with user/assistant alignment and colors
 * without requiring the CopilotKit runtime. Designed for compact
 * card previews — the full CustomCopilotKitChat is used in detail views.
 */

import { Box, Text, VStack } from "@chakra-ui/react";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

type MessagePreviewProps = {
  messages: ScenarioRunData["messages"];
};

function extractContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item && "text" in item)
          return (item as { text: string }).text;
        if (typeof item === "object" && item && "type" in item) {
          const typed = item as { type: string; name?: string };
          if (typed.type === "tool_use") return `[Tool: ${typed.name ?? "unknown"}]`;
          if (typed.type === "tool_result") return "[Tool result]";
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

export function MessagePreview({ messages }: MessagePreviewProps) {
  if (!messages || messages.length === 0) {
    return (
      <Text fontSize="xs" color="fg.muted" padding={3}>
        No messages
      </Text>
    );
  }

  return (
    <VStack
      align="stretch"
      gap={1.5}
      padding={3}
      height="100%"
      overflow="hidden"
    >
      {messages.map((message, index) => {
        const content = extractContent(message.content);
        if (!content || content === "None") return null;

        const isUser = message.role === "user";

        return (
          <Box
            key={message.id ?? index}
            alignSelf={isUser ? "flex-end" : "flex-start"}
            maxWidth="85%"
          >
            <Box
              bg={isUser ? "blue.500" : "bg.subtle"}
              color={isUser ? "white" : "fg"}
              borderRadius="lg"
              paddingX={2.5}
              paddingY={1.5}
              fontSize="xs"
              lineClamp={3}
            >
              {content}
            </Box>
          </Box>
        );
      })}
    </VStack>
  );
}
