import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { type ScenarioMessageSnapshotEvent } from "~/app/api/scenario-events/[[...route]]/schemas";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { useEffect } from "react";
import {
  TextMessage,
  Role,
  type MessageRole,
  type Message,
} from "@copilotkit/runtime-client-gql";
import { CopilotChat } from "@copilotkit/react-ui";

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
    setMessages(
      messages
        .map((message) => {
          if (
            [Role.User, Role.Assistant].includes(message.role as MessageRole)
          ) {
            return new TextMessage({
              id: message.id,
              role: message.role as MessageRole,
              content: message.content ?? "",
            });
          }

          return null;
        })
        .filter(Boolean) as Message[]
    );
  }, [messages]);

  return <CopilotChat Input={() => <div></div>} />;
}
