/**
 * Lightweight chat message preview for grid cards.
 *
 * Renders scenario messages with user/assistant alignment and colors
 * without requiring the CopilotKit runtime. Designed for compact
 * card previews — the full SimulationChat is used in detail views.
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Settings } from "react-feather";
import type { StreamingMessage } from "~/hooks/useSimulationStreamingState";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

type MessagePreviewProps = {
  messages: ScenarioRunData["messages"];
  streamingMessages?: StreamingMessage[];
};

/** Extract text from plain strings or multimodal content arrays. */
function textContent(content: unknown): string {
  if (typeof content === "string") {
    // Try to parse as JSON array (multimodal content like [{type:"text",...},{type:"file",...}])
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return extractTextParts(parsed);
      }
    } catch {
      // Not JSON — return as-is
    }
    return content;
  }
  if (Array.isArray(content)) {
    return extractTextParts(content);
  }
  return "";
}

function extractTextParts(parts: unknown[]): string {
  return parts
    .filter(
      (item): item is { type: string; text: string } =>
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>).type === "text" &&
        typeof (item as Record<string, unknown>).text === "string",
    )
    .map((item) => item.text)
    .join(" ");
}

function TypingIndicator() {
  return (
    <Box
      display="flex"
      gap="3px"
      alignItems="center"
      height="14px"
      css={{
        "@keyframes pulse-dot": {
          "0%, 80%, 100%": { opacity: 0.3 },
          "40%": { opacity: 1 },
        },
      }}
    >
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          width="5px"
          height="5px"
          borderRadius="full"
          bg="fg.muted"
          animation="pulse-dot 1.4s infinite"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </Box>
  );
}

export function MessagePreview({
  messages,
  streamingMessages,
}: MessagePreviewProps) {
  // Build set of server message IDs for deduplication
  const serverMessageIds = new Set(
    (messages ?? []).map((m) => m.id).filter(Boolean),
  );

  // Filter streaming messages not yet in server data
  const pendingStreaming = (streamingMessages ?? []).filter(
    (sm) => !serverMessageIds.has(sm.messageId),
  );

  const allEmpty =
    (!messages || messages.length === 0) && pendingStreaming.length === 0;

  if (allEmpty) {
    return (
      <VStack
        align="stretch"
        gap={1.5}
        padding={3}
        height="100%"
        justifyContent="flex-end"
        css={{
          "@keyframes shimmer": {
            "0%": { opacity: 0.3 },
            "50%": { opacity: 0.55 },
            "100%": { opacity: 0.3 },
          },
        }}
      >
        {/* Skeleton user message */}
        <Box alignSelf="flex-end" maxWidth="65%">
          <Box
            bg="bg.muted"
            borderRadius="lg"
            h="28px"
            w="100%"
            css={{ animation: "shimmer 2s ease-in-out infinite" }}
          />
        </Box>
        {/* Skeleton assistant message */}
        <VStack align="flex-start" gap={1} maxWidth="80%">
          <Box
            bg="bg.subtle"
            borderRadius="lg"
            h="12px"
            w="100%"
            css={{ animation: "shimmer 2s ease-in-out 0.2s infinite" }}
          />
          <Box
            bg="bg.subtle"
            borderRadius="lg"
            h="12px"
            w="70%"
            css={{ animation: "shimmer 2s ease-in-out 0.4s infinite" }}
          />
        </VStack>
      </VStack>
    );
  }

  return (
    <VStack
      align="stretch"
      gap={1.5}
      padding={3}
      height="100%"
      overflow="hidden"
      justifyContent="flex-end"
    >
      {(messages ?? []).map((message, index) => {
        // Tool call indicators (assistant messages with tool_calls or toolCalls)
        const toolCalls = ("tool_calls" in message && message.tool_calls)
          ? message.tool_calls
          : ("toolCalls" in message && (message as Record<string, unknown>).toolCalls)
            ? (message as Record<string, unknown>).toolCalls as Array<{ function?: { name?: string } }>
            : null;
        if (toolCalls) {
          return toolCalls.map((tc: { function?: { name?: string } }, tcIdx: number) => (
            <HStack
              key={`${message.id ?? index}-tc-${tcIdx}`}
              alignSelf="flex-start"
              gap={1}
            >
              <Box color="orange.fg">
                <Settings size={10} />
              </Box>
              <Text fontSize="2xs" color="orange.fg" fontWeight="medium" lineClamp={1}>
                {tc.function?.name ?? "tool"}
              </Text>
            </HStack>
          ));
        }

        // Tool results
        if (message.role === "tool") {
          const resultText = textContent(message.content);
          if (!resultText) return null;
          return (
            <Box
              key={message.id ?? index}
              alignSelf="flex-start"
              maxWidth="85%"
            >
              <Box
                bg="bg.subtle"
                borderRadius="lg"
                paddingX={2.5}
                paddingY={1.5}
                fontSize="xs"
                color="fg.muted"
                lineClamp={2}
              >
                {resultText}
              </Box>
            </Box>
          );
        }

        const text = textContent(message.content);
        if (!text || text === "None") return null;

        const isUser = message.role === "user";

        return (
          <Box
            key={message.id ?? index}
            alignSelf={isUser ? "flex-end" : "flex-start"}
            maxWidth="85%"
          >
            <Box
              bg={isUser ? "gray.600" : "bg.subtle"}
              color={isUser ? "white" : "fg"}
              borderRadius="lg"
              paddingX={2.5}
              paddingY={1.5}
              fontSize="xs"
              lineClamp={3}
            >
              {text}
            </Box>
          </Box>
        );
      })}
      {pendingStreaming.map((sm) => {
        const isUser = sm.role === "user";
        return (
          <Box
            key={sm.messageId}
            alignSelf={isUser ? "flex-end" : "flex-start"}
            maxWidth="85%"
          >
            <Box
              bg={isUser ? "gray.600" : "bg.subtle"}
              color={isUser ? "white" : "fg"}
              borderRadius="lg"
              paddingX={2.5}
              paddingY={1.5}
              fontSize="xs"
              lineClamp={3}
            >
              {sm.content || <TypingIndicator />}
            </Box>
          </Box>
        );
      })}
    </VStack>
  );
}