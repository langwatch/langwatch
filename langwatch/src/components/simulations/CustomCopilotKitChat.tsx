import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { ScenarioMessageSnapshotEvent } from "~/app/api/scenario-events/[[...route]]/types";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { useEffect } from "react";
import {
  ActionExecutionMessage,
  ResultMessage,
} from "@copilotkit/runtime-client-gql";
import { CopilotChat } from "@copilotkit/react-ui";
import { ToolResultMessage } from "./messages/ToolResultMessage";
import { ToolCallMessage } from "./messages/ToolCallMessage";
import { convertScenarioMessagesToCopilotKit } from "./utils/convert-scenario-messages";
import { createLogger } from "~/utils/logger";

const logger = createLogger("CustomCopilotKitChat.tsx");

/**
 * This is a wrapper around the CopilotKit component that allows us to use the CopilotKit chat without having to
 * worry about the runtime.
 * @param messages - The messages to display in the chat.
 * @returns A CopilotKit component with the chat history of the simulation.
 */
export function CustomCopilotKitChat({
  messages,
}: {
  messages: ScenarioMessageSnapshotEvent["messages"];
}) {
  const { project } = useOrganizationTeamProject();
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      headers={{
        "X-Auth-Token": project?.apiKey ?? "",
      }}
    >
      <CustomCopilotKitChatInner messages={messages} />
    </CopilotKit>
  );
}

function CustomCopilotKitChatInner({
  messages,
}: {
  messages: ScenarioMessageSnapshotEvent["messages"];
}) {
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
        "Failed to convert scenario messages to CopilotKit messages"
      );
    }
  }, [messages]);

  return (
    <CopilotChat
      RenderActionExecutionMessage={({ message }) => (
        <ToolCallMessage message={message as ActionExecutionMessage} />
      )}
      RenderResultMessage={({ message }) => (
        <ToolResultMessage message={message as ResultMessage} />
      )}
      Input={() => <div></div>}
    />
  );
}
