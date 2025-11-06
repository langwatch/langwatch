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
import { LuListTree } from "react-icons/lu";
import { useDrawer } from "../CurrentDrawer";
import { Markdown } from "../Markdown";

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
                          { replace: true },
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
      RenderActionExecutionMessage={({ message }) =>
        !smallerView ? (
          <ToolCallMessage message={message as ActionExecutionMessage} />
        ) : null
      }
      RenderResultMessage={({ message }) =>
        !smallerView ? (
          <ToolResultMessage message={message as ResultMessage} />
        ) : null
      }
      Input={() => <div></div>}
    />
  );
}
