import { VStack, Text, Button, HStack } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { ScenarioMessageSnapshotEvent } from "~/app/api/scenario-events/[[...route]]/types";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { useEffect } from "react";
import {
  ActionExecutionMessage,
  ResultMessage,
  Role,
  TextMessage,
} from "@copilotkit/runtime-client-gql";
import { CopilotChat, Markdown } from "@copilotkit/react-ui";
import { ToolResultMessage } from "./messages/ToolResultMessage";
import { ToolCallMessage } from "./messages/ToolCallMessage";
import { convertScenarioMessagesToCopilotKit } from "./utils/convert-scenario-messages";
import { createLogger } from "~/utils/logger";
import { LuListTree } from "react-icons/lu";
import { useDrawer } from "../CurrentDrawer";

const logger = createLogger("CustomCopilotKitChat.tsx");

/**
 * This is a wrapper around the CopilotKit component that allows us to use the CopilotKit chat without having to
 * worry about the runtime.
 * @param messages - The messages to display in the chat.
 * @returns A CopilotKit component with the chat history of the simulation.
 */
export function CustomCopilotKitChat({
  messages,
  smallerView,
}: {
  messages: ScenarioMessageSnapshotEvent["messages"];
  smallerView?: boolean;
}) {
  const { project } = useOrganizationTeamProject();
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      headers={{
        "X-Auth-Token": project?.apiKey ?? "",
      }}
    >
      <CustomCopilotKitChatInner
        messages={messages}
        smallerView={smallerView}
      />
    </CopilotKit>
  );
}

function CustomCopilotKitChatInner({
  messages,
  smallerView,
}: {
  messages: ScenarioMessageSnapshotEvent["messages"];
  smallerView?: boolean;
}) {
  const { project } = useOrganizationTeamProject();
  const { setMessages } = useCopilotChat({
    headers: {
      "X-Auth-Token": project?.apiKey ?? "",
    },
  });

  const { openDrawer, drawerOpen } = useDrawer();

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
      RenderTextMessage={({
        message,
        isCurrentMessage,
        AssistantMessage,
        UserMessage,
        inProgress,
      }) => {
        const message_ = message as TextMessage & { traceId?: string };

        return (
          <VStack
            align={message_.role === Role.Assistant ? "flex-start" : "flex-end"}
          >
            {AssistantMessage && message_.role === Role.Assistant && (
              <AssistantMessage
                message={message_.content}
                rawData={message}
                isCurrentMessage={isCurrentMessage}
                isGenerating={inProgress}
                isLoading={inProgress}
              />
            )}
            {UserMessage && message_.role === Role.User && (
              <UserMessage message={message_.content} rawData={message} />
            )}
            {!smallerView &&
              message_.traceId &&
              message_.role === Role.Assistant && (
                <HStack marginTop={-6} paddingBottom={4}>
                  <Button
                    onClick={() => {
                      if (drawerOpen("traceDetails")) {
                        openDrawer(
                          "traceDetails",
                          {
                            traceId: message_.traceId ?? "",
                            selectedTab: "traceDetails",
                          },
                          { replace: true }
                        );
                      } else {
                        openDrawer("traceDetails", {
                          traceId: message_.traceId ?? "",
                          selectedTab: "traceDetails",
                        });
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
      }}
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
