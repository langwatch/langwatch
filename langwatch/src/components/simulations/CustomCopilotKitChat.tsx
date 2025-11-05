import { VStack, Button, HStack } from "@chakra-ui/react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { useEffect } from "react";
import {
  type ActionExecutionMessage,
  type ResultMessage,
  Role,
  type TextMessage,
  type Message,
} from "@copilotkit/runtime-client-gql";
import { CopilotChat } from "@copilotkit/react-ui";
import { ToolResultMessage } from "./messages/ToolResultMessage";
import { ToolCallMessage } from "./messages/ToolCallMessage";
import { LuListTree } from "react-icons/lu";
import { useDrawer } from "../CurrentDrawer";
import { Markdown } from "../Markdown";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

interface CustomCopilotKitChatProps {
  messages: (Message & { traceId?: string })[];
  smallerView?: boolean;
}

/**
 * This is a wrapper around the CopilotKit component that allows us to use the CopilotKit chat without having to
 * worry about the runtime.
 * @param messages - The messages to display in the chat.
 * @returns A CopilotKit component with the chat history of the simulation.
 */
export function CustomCopilotKitChat({
  messages,
  smallerView,
}: CustomCopilotKitChatProps) {
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

type CustomCopilotKitChatInnerProps = CustomCopilotKitChatProps;

/**
 * Inner component that renders the CopilotKit chat.
 */
function CustomCopilotKitChatInner({
  messages,
  smallerView,
}: CustomCopilotKitChatInnerProps) {
  const { setMessages } = useCopilotChat();

  useEffect(() => {
    if (messages?.length > 0) {
      setMessages(messages);
    }
  }, [messages, setMessages]);

  const { openDrawer, drawerOpen } = useDrawer();

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
