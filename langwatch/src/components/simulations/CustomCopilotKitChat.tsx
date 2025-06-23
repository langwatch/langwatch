import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { ScenarioMessageSnapshotEvent } from "~/app/api/scenario-events/[[...route]]/types";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { useEffect } from "react";
import {
  TextMessage,
  Role,
  type MessageRole,
  type Message,
  ActionExecutionMessage,
  ResultMessage,
} from "@copilotkit/runtime-client-gql";
import { CopilotChat } from "@copilotkit/react-ui";
import { VStack, HStack, Text, Box } from "@chakra-ui/react";
import { Settings } from "react-feather";
import { RenderInputOutput } from "../traces/RenderInputOutput";

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

  const safeJsonParseOrStringFallback = (json: string) => {
    try {
      return JSON.parse(json);
    } catch (e) {
      return {
        data: json,
      };
    }
  };

  useEffect(() => {
    setMessages(
      messages
        .flatMap((message) => {
          if (
            [Role.User, Role.Assistant].includes(message.role as MessageRole)
          ) {
            let toolCalls: ActionExecutionMessage[] = [];
            if ("toolCalls" in message && message.toolCalls) {
              toolCalls = message.toolCalls.map((toolCall) => {
                return new ActionExecutionMessage({
                  id: message.id,
                  name: toolCall.function?.name,
                  arguments: safeJsonParseOrStringFallback(
                    toolCall.function?.arguments ?? "{}"
                  ),
                });
              });
            }
            return [
              ...(message.content && message.content !== "None"
                ? [
                    new TextMessage({
                      id: message.id,
                      role: message.role as MessageRole,
                      content: message.content ?? "",
                    }),
                  ]
                : []),
              ...toolCalls,
            ] as Message[];
          }
          if (message.role === Role.Tool) {
            return [
              new ResultMessage({
                id: message.id,
                actionExecutionId: message.id,
                actionName: "tool",
                result: safeJsonParseOrStringFallback(message.content ?? "{}"),
              }),
            ];
          }

          return null;
        })
        .filter(Boolean) as Message[]
    );
  }, [messages]);

  const ToolCallMessage = ({
    message,
  }: {
    message: ActionExecutionMessage;
  }) => {
    return (
      <VStack w="full" gap={2} mb={2} align="start">
        <HStack gap={2}>
          <Settings size={12} color="#ea580c" />
          <Text fontSize="xs" color="orange.600" fontWeight="medium">
            {message.name}
          </Text>
        </HStack>
        <Box
          w="full"
          bg="gray.50"
          border="1px solid"
          borderColor="gray.200"
          borderRadius="lg"
          p={3}
        >
          <Text fontSize="xs" fontWeight="semibold" color="gray.600" mb={2}>
            Tool arguments
          </Text>
          <Box
            bg="white"
            border="1px solid"
            borderColor="gray.200"
            borderRadius="md"
            p={2}
          >
            <RenderInputOutput value={message.arguments} />
          </Box>
        </Box>
      </VStack>
    );
  };

  const ToolResultMessage = ({ message }: { message: ResultMessage }) => {
    return (
      <VStack w="full" gap={2} mb={2} align="start">
        <Box
          w="full"
          bg="gray.50"
          border="1px solid"
          borderColor="gray.200"
          borderRadius="lg"
          p={3}
        >
          <Text fontSize="xs" fontWeight="semibold" color="gray.600" mb={2}>
            Tool result
          </Text>
          <Box
            bg="white"
            border="1px solid"
            borderColor="gray.200"
            borderRadius="md"
            p={2}
          >
            <RenderInputOutput value={message.result} />
          </Box>
        </Box>
      </VStack>
    );
  };

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
