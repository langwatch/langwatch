import { VStack, Button, HStack } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { ScenarioMessageSnapshotEvent } from "~/app/api/scenario-events/[[...route]]/types";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { useEffect } from "react";
import {
  type ActionExecutionMessage,
  type ResultMessage,
  Role,
  type TextMessage,
} from "@copilotkit/runtime-client-gql";
import { CopilotChat } from "@copilotkit/react-ui";
import { ToolResultMessage } from "./messages/ToolResultMessage";
import { ToolCallMessage } from "./messages/ToolCallMessage";
import { convertScenarioMessagesToCopilotKit } from "./utils/convert-scenario-messages";
import { createLogger } from "~/utils/logger";
import { Markdown } from "../Markdown";
import { TraceMessage } from "../copilot-kit/TraceMessage";

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
  }, [messages]);

  return (
    <CopilotChat
      RenderTextMessage={({ message, AssistantMessage, UserMessage }) => {
        const message_ = message as TextMessage & { traceId?: string };

        return (
          <VStack
            align={message_.role === Role.Assistant ? "flex-start" : "flex-end"}
          >
            {AssistantMessage && message_.role === Role.Assistant && (
              <Markdown className="markdown">{message_.content}</Markdown>
            )}
            {UserMessage && message_.role === Role.User && (
              <UserMessage message={message_.content} rawData={message} />
            )}
            {!smallerView &&
              message_.traceId &&
              message_.role === Role.Assistant && (
                <TraceMessage traceId={message_.traceId} />
              )}
          </VStack>
        );
      }}
      RenderActionExecutionMessage={({ message }) => (
        <ToolCallMessage message={message as ActionExecutionMessage} />
      )}
      RenderResultMessage={({ message }) => (
        <ToolResultMessage message={message as ResultMessage} />
      )}
      Input={hideInput ? () => <div></div> : undefined}
    />
  );
}
