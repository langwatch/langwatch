import { VStack } from "@chakra-ui/react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import {
  type ActionExecutionMessage,
  type ResultMessage,
  Role,
  type TextMessage,
} from "@copilotkit/runtime-client-gql";
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

function CustomCopilotKitChatInner({
  messages,
  smallerView,
  hideInput,
}: CustomCopilotKitChatInnerProps) {
  const { project } = useOrganizationTeamProject();
  const { setMessages } = useCopilotChat({
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
      RenderTextMessage={({ message, AssistantMessage, UserMessage }) => {
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
            {UserMessage && message_.role === Role.User && (
              <UserMessage message={message_.content} rawData={message} />
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
