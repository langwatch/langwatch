import { VStack } from "@chakra-ui/react";
import { CopilotKit, useCopilotChatInternal } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { Role } from "@copilotkit/runtime-client-gql";
import type { Message } from "@copilotkit/shared";
import { useEffect, useMemo } from "react";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { createLogger } from "~/utils/logger";
import { TraceMessage } from "../copilot-kit/TraceMessage";
import { Markdown } from "../Markdown";
import { ToolCallMessage } from "./messages/ToolCallMessage";
import { ToolResultMessage } from "./messages/ToolResultMessage";
import { convertScenarioMessagesToCopilotKit } from "./utils/convert-scenario-messages";

const logger = createLogger("CustomCopilotKitChat.tsx");

type CustomCopilotKitChatProps = CustomCopilotKitChatInnerProps;

interface CustomCopilotKitChatInnerProps {
  messages: ScenarioMessageSnapshotEvent["messages"];
  smallerView?: boolean;
  hideInput?: boolean;
}

/**
 * This is a wrapper around the CopilotKit component that allows us to use the CopilotKit chat without having to
 * worry about the runtime.
 * @param messages - The messages to display in the chat.
 * @returns A CopilotKit component with the chat history of the simulation.
 */
export function CustomCopilotKitChat({
  ...innerProps
}: CustomCopilotKitChatProps) {
  const { project } = useOrganizationTeamProject();
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      headers={{
        "X-Auth-Token": project?.apiKey ?? "",
      }}
    >
      <CustomCopilotKitChatInner {...innerProps} />
    </CopilotKit>
  );
}

function isTextLike(msg: Message): msg is Message & { content: string } {
  return msg.role === "user" || msg.role === "assistant";
}

function CustomCopilotKitChatInner({
  messages,
  smallerView,
  hideInput,
}: CustomCopilotKitChatInnerProps) {
  const { project } = useOrganizationTeamProject();
  const { setMessages } = useCopilotChatInternal({
    headers: {
      "X-Auth-Token": project?.apiKey ?? "",
    },
  });

  // Build a stable traceId lookup from converted messages.
  // CopilotKit's setMessages reconstructs message objects internally,
  // stripping custom properties like traceId. We keep our own map
  // keyed by message ID so the trace buttons persist across re-renders.
  const traceIdMap = useMemo(() => {
    try {
      const converted = convertScenarioMessagesToCopilotKit(messages);
      const map = new Map<string, string>();
      for (const msg of converted) {
        if (msg.traceId && msg.id) {
          map.set(msg.id, msg.traceId);
        }
      }
      return map;
    } catch {
      return new Map<string, string>();
    }
  }, [messages]);

  useEffect(() => {
    try {
      const convertedMessages = convertScenarioMessagesToCopilotKit(messages);
      setMessages(convertedMessages);
    } catch (error) {
      logger.error(
        {
          error,
        },
        "Failed to convert scenario messages to CopilotKit messages",
      );
    }
  }, [messages, setMessages]);

  const fadeInCss = {
    animation: "fadeIn 0.3s ease-in",
    "@keyframes fadeIn": {
      from: { opacity: 0, transform: "translateY(4px)" },
      to: { opacity: 1, transform: "translateY(0)" },
    },
  } as const;

  return (
    <CopilotChat
      RenderMessage={({ message, UserMessage, ImageRenderer }) => {
        const traceId = traceIdMap.get(message.id);

        if (isTextLike(message)) {
          return (
            <VStack
              align={message.role === "assistant" ? "flex-start" : "flex-end"}
              css={fadeInCss}
            >
              {message.role === "assistant" && (
                <Markdown className="markdown">{message.content}</Markdown>
              )}
              {UserMessage && message.role === "user" && (
                <UserMessage
                  message={{ id: message.id, role: "user" as const, content: message.content }}
                  ImageRenderer={ImageRenderer!}
                  rawData={message}
                />
              )}
              {!smallerView &&
                traceId &&
                message.role === "assistant" && (
                  <TraceMessage traceId={traceId} />
                )}
            </VStack>
          );
        }

        // Tool results or other unhandled message types
        if ("content" in message) {
          return (
            <VStack align="flex-start" gap={6} css={fadeInCss}>
              <ToolResultMessage message={message as any} />
              {!smallerView && traceId && (
                <TraceMessage traceId={traceId} />
              )}
            </VStack>
          );
        }

        return null;
      }}
      Input={hideInput ? () => <div></div> : undefined}
    />
  );
}
