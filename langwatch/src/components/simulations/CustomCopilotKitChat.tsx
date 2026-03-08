import { VStack } from "@chakra-ui/react";
import { CopilotKit, useCopilotChatInternal } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import {
  type ActionExecutionMessage,
  type ResultMessage,
  Role,
  type TextMessage,
  TextMessage as TextMessageClass,
  type MessageRole,
} from "@copilotkit/runtime-client-gql";
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

function CustomCopilotKitChatInner({
  messages,
  streamingMessages,
  variant,
}: CustomCopilotKitChatProps) {
  const { project } = useOrganizationTeamProject();
  const smallerView = variant === "grid";
  const hideInput = true;

  const { setMessages } = useCopilotChatInternal();

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
      RenderTextMessage={({ message, UserMessage, ImageRenderer }) => {
        const message_ = message as TextMessage;
        const traceId = traceIdMap.get(message_.id);

        return (
          <VStack
            align={message_.role === Role.Assistant ? "flex-start" : "flex-end"}
            css={fadeInCss}
          >
            {message_.role === Role.Assistant && (
              <Markdown className="markdown">{message_.content}</Markdown>
            )}
            {UserMessage && ImageRenderer && message_.role === Role.User && (
              <UserMessage
                message={{ id: message_.id, role: "user" as const, content: message_.content }}
                ImageRenderer={ImageRenderer}
                rawData={message}
              />
            )}
            {!smallerView &&
              traceId &&
              message_.role === Role.Assistant && (
                <TraceMessage traceId={traceId} />
              )}
          </VStack>
        );
      }}
      RenderActionExecutionMessage={({ message }) => {
        const message_ = message as ActionExecutionMessage;
        const traceId = traceIdMap.get(message_.id);

        return (
          <VStack align="flex-start" gap={6} css={fadeInCss}>
            <ToolCallMessage message={message_} />
            {!smallerView && traceId && (
              <TraceMessage traceId={traceId} />
            )}
          </VStack>
        );
      }}
      RenderResultMessage={({ message }) => {
        const message_ = message as ResultMessage;
        const traceId = traceIdMap.get(message_.id);

        return (
          <VStack align="flex-start" gap={6} css={fadeInCss}>
            <ToolResultMessage message={message_} />
            {!smallerView && traceId && (
              <TraceMessage traceId={traceId} />
            )}
          </VStack>
        );
      }}
      Input={hideInput ? () => <div></div> : undefined}
    />
  );
}
