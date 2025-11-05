import { VStack, Button, HStack } from "@chakra-ui/react";
import { LuListTree } from "react-icons/lu";
import { Role } from "@copilotkit/runtime-client-gql";
import type { MessageItemProps } from "./types";
import { Markdown } from "../../Markdown";
import { ToolCallMessage } from "../messages/ToolCallMessage";
import { ToolResultMessage } from "../messages/ToolResultMessage";
import { useDrawer } from "../../CurrentDrawer";
import { UserMessage as CopilotKitUserMessage } from "@copilotkit/react-ui";

/**
 * Renders a single chat message with appropriate styling and actions
 * Single Responsibility: Display message content based on role and type
 */
export function MessageItem({ message, smallerView }: MessageItemProps) {
  const { openDrawer, drawerOpen } = useDrawer();

  // Handle ActionExecutionMessage
  if (!smallerView && message.type === "ActionExecutionMessage") {
    return <ToolCallMessage message={message as any} />;
  }

  // Handle ResultMessage
  if (!smallerView && message.type === "ResultMessage") {
    return <ToolResultMessage message={message as any} />;
  }

  // Handle TextMessage
  if (message.type === "TextMessage") {
    const textMessage = message as any;
    const isAssistant = textMessage.role === Role.Assistant;

    return (
      <VStack align={isAssistant ? "flex-start" : "flex-end"}>
        {isAssistant ? (
          <Markdown className="markdown">{textMessage.content}</Markdown>
        ) : (
          <CopilotKitUserMessage
            message={textMessage.content}
            rawData={message}
          />
        )}

        {!smallerView && textMessage.traceId && isAssistant && (
          <HStack marginTop={-6} paddingBottom={4}>
            <Button
              onClick={() => {
                const payload = {
                  traceId: textMessage.traceId,
                  selectedTab: "traceDetails" as const,
                };

                if (drawerOpen("traceDetails")) {
                  openDrawer("traceDetails", payload, { replace: true });
                } else {
                  openDrawer("traceDetails", payload);
                }
              }}
            >
              <LuListTree />
              View Trace
            </Button>
          </HStack>
        )}
      </VStack>
    );
  }

  return null;
}
