import { VStack } from "@chakra-ui/react";
import { CopilotKit, useCopilotChatInternal } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import {
  Role,
  TextMessage as TextMessageClass,
  type MessageRole,
} from "@copilotkit/runtime-client-gql";
import type { Message } from "@copilotkit/shared";
import { useEffect, useMemo } from "react";
import type { StreamingMessage } from "~/hooks/useSimulationStreamingState";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { createLogger } from "~/utils/logger";
import { TraceMessage } from "../copilot-kit/TraceMessage";
import { Markdown } from "../Markdown";
import { ToolCallMessage } from "./messages/ToolCallMessage";
import { ToolResultMessage } from "./messages/ToolResultMessage";
import { convertScenarioMessagesToCopilotKit } from "./utils/convert-scenario-messages";

const logger = createLogger("CustomCopilotKitChat.tsx");

interface CustomCopilotKitChatProps {
  messages: ScenarioMessageSnapshotEvent["messages"];
  streamingMessages?: StreamingMessage[];
  variant: "grid" | "drawer";
}

export function CustomCopilotKitChat(props: CustomCopilotKitChatProps) {
  const { project } = useOrganizationTeamProject();
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      headers={{
        "X-Auth-Token": project?.apiKey ?? "",
      }}
    >
      <CustomCopilotKitChatInner {...props} />
    </CopilotKit>
  );
}

function isTextLike(msg: Message): msg is Message & { content: string } {
  return msg.role === "user" || msg.role === "assistant";
}

function CustomCopilotKitChatInner({
  messages,
  streamingMessages,
  variant,
}: CustomCopilotKitChatProps) {
  const { project } = useOrganizationTeamProject();
  const smallerView = variant === "grid";
  const hideInput = true;

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

      // Merge streaming messages that are not yet in server data
      if (streamingMessages?.length) {
        const serverIds = new Set(
          messages.map((m) => m.id).filter(Boolean),
        );

        const toAppend = streamingMessages
          .filter((sm) => !serverIds.has(sm.messageId))
          .map(
            (sm) =>
              new TextMessageClass({
                id: sm.messageId,
                role: (sm.role === "user" ? Role.User : Role.Assistant) as MessageRole,
                content: sm.content || "\u2026",
              }),
          );

        setMessages([...convertedMessages, ...toAppend]);
      } else {
        setMessages(convertedMessages);
      }
    } catch (error) {
      logger.error(
        {
          error,
        },
        "Failed to convert scenario messages to CopilotKit messages",
      );
    }
  }, [messages, streamingMessages, setMessages]);

  const fadeInCss = {
    animation: "fadeIn 0.3s ease-in",
    "@keyframes fadeIn": {
      from: { opacity: 0, transform: "translateY(4px)" },
      to: { opacity: 1, transform: "translateY(0)" },
    },
  } as const;

  return (
    <CopilotChat
      className={smallerView ? "copilotKitGrid" : "copilotKitDrawer"}
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
