import { useMemo } from "react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import type { z } from "zod";
import { type runtimeInputsSchema } from "~/prompt-configs/schemas/field-schemas";
import { SyncedChatInput } from "./SyncedChatInput";
import { TraceMessage } from "~/components/copilot-kit/TraceMessage";
import { Box, Text, VStack, type BoxProps } from "@chakra-ui/react";
import clsx from "clsx";
import {
  type TextMessage,
  Role,
  type Message,
} from "@copilotkit/runtime-client-gql";

interface PromptStudioChatProps extends BoxProps {
  formValues: PromptConfigFormValues;
  variables?: z.infer<typeof runtimeInputsSchema>;
}

export function PromptStudioChat(props: PromptStudioChatProps) {
  const { formValues, variables, ...boxProps } = props;
  const { project } = useOrganizationTeamProject();
  const additionalParams = useMemo(() => {
    return JSON.stringify({
      formValues,
      variables,
    });
  }, [formValues, variables]);

  return (
    <Box
      width="full"
      height="full"
      {...boxProps}
      className={clsx("prompt-studio-chat", boxProps.className)}
    >
      <CopilotKit
        // agent="prompt_execution"
        runtimeUrl="/api/copilotkit"
        headers={{
          "X-Auth-Token": project?.apiKey ?? "",
        }}
        forwardedParameters={{
          // @ts-expect-error - Total hack to pass additional params to the service adapter
          model: additionalParams,
        }}
        onError={(error: Error) => {
          console.error(error);
        }}
        disableSystemMessage
      >
        <PromptStudioChatInner />
      </CopilotKit>
    </Box>
  );
}

function PromptStudioChatInner() {
  const { visibleMessages } = useCopilotChat();

  console.log("visibleMessages", visibleMessages);
  return (
    <CopilotChat
      Input={SyncedChatInput}
      RenderActionExecutionMessage={({ message }) => {
        console.log("message", message);
        return null;
      }}
      // RenderTextMessage={({ message, AssistantMessage, UserMessage }) => {
      //   const message_ = message as TextMessage & { traceId?: string };

      //   console.log("message_", message_);

      //   return (
      //     <VStack
      //       align={message_.role === Role.Assistant ? "flex-start" : "flex-end"}
      //     >
      //       {AssistantMessage && message_.role === Role.Assistant && (
      //         <AssistantMessage
      //           message={message_.content}
      //           rawData={message_}
      //           isLoading={false}
      //           isGenerating={false}
      //         />
      //       )}
      //       {UserMessage && message_.role === Role.User && (
      //         <UserMessage message={message_.content} rawData={message_} />
      //       )}
      //       {message_.traceId && message_.role === Role.Assistant && (
      //         <TraceMessage
      //           traceId={message_.traceId}
      //           marginLeft="auto"
      //           marginY={1}
      //         />
      //       )}
      //     </VStack>
      //   );
      // }}
      // RenderAgentStateMessage={({ message }) => {
      //   const message_ = message as Message & { state: { traceId: string } };
      //   return (
      //     <TraceMessage
      //       traceId={message_.state.traceId}
      //       marginLeft="auto"
      //       marginY={1}
      //     />
      //   );
      // }}
    />
  );
}
