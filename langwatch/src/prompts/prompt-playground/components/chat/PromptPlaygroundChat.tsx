import { Box, type BoxProps } from "@chakra-ui/react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import {
  AssistantMessage,
  CopilotChat,
  UserMessage,
} from "@copilotkit/react-ui";
import clsx from "clsx";
import { forwardRef, useEffect, useImperativeHandle, useMemo } from "react";
import type { z } from "zod";
import { TraceMessage } from "~/components/copilot-kit/TraceMessage";
import { convertScenarioMessagesToCopilotKit } from "~/components/simulations/utils/convert-scenario-messages";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { runtimeInputsSchema } from "~/prompts/schemas/field-schemas";
import type { PromptConfigFormValues } from "~/prompts/types";
import type { ChatMessage } from "~/server/tracer/types";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { useTabId } from "../prompt-browser/ui/TabContext";
import { DeletableMessage } from "./DeletableMessage";
import { ErrorMessage } from "./ErrorMessage";
import { StructuredOutputDisplay } from "./StructuredOutputDisplay";
import { SyncedChatInput } from "./SyncedChatInput";

interface PromptPlaygroundChatProps extends BoxProps {
  formValues: PromptConfigFormValues;
  variables?: z.infer<typeof runtimeInputsSchema>;
}

/**
 * PromptPlaygroundChatRef
 * Single Responsibility: Exposes imperative methods to control the chat instance (e.g., reset, focus).
 */
export interface PromptPlaygroundChatRef {
  resetChat: () => void;
  focusInput: () => void;
}

const PromptPlaygroundChat = forwardRef<
  PromptPlaygroundChatRef,
  PromptPlaygroundChatProps
>(function PromptPlaygroundChat(props, ref) {
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
        runtimeUrl="/api/copilotkit"
        headers={{
          "X-Auth-Token": project?.apiKey ?? "",
        }}
        forwardedParameters={{
          // @ts-expect-error - Total hack to pass additional params to the service adapter
          model: additionalParams,
        }}
        onError={(error: Error) => {
          console.error("CopilotKit error:", error);
        }}
        disableSystemMessage
      >
        <PromptPlaygroundChatInner ref={ref} />
      </CopilotKit>
    </Box>
  );
});

const PromptPlaygroundChatInner = forwardRef<PromptPlaygroundChatRef, object>(
  function PromptPlaygroundChatInner(_props, ref) {
    const tabId = useTabId();
    const { getTabById } = useDraggableTabsBrowserStore((state) => ({
      getTabById: state.getByTabId,
    }));
    const { setMessages, visibleMessages } = useCopilotChat({});
    const { updateTabData } = useDraggableTabsBrowserStore((state) => ({
      updateTabData: state.updateTabData,
    }));

    useImperativeHandle(ref, () => ({
      resetChat: () => {
        void setMessages([]);
      },
      focusInput: () => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          `textarea[data-tab-id="${tabId}"]`,
        );
        textarea?.focus();
      },
    }));

    const deleteMessage = (messageId: string) => {
      const updatedMessages = visibleMessages.filter(
        (message) => message.id !== messageId,
      );

      setMessages(updatedMessages);
    };

    useEffect(() => {
      const tab = getTabById(tabId);
      const initialMessagesFromSpanData =
        tab?.chat?.initialMessagesFromSpanData;
      if (initialMessagesFromSpanData?.length) {
        void setMessages(
          convertScenarioMessagesToCopilotKit(initialMessagesFromSpanData),
        );
      }
    }, [setMessages, tabId, getTabById]);

    /**
     * Sync the visible messages to the tab data.
     */
    useEffect(() => {
      const tab = getTabById(tabId);
      if (tab) {
        updateTabData({
          tabId,
          updater: (data) => ({
            ...(data || {}),
            chat: {
              ...(data?.chat || {}),
              initialMessagesFromSpanData: visibleMessages
                .filter((message) => message.isTextMessage())
                .map((message) => {
                  const textMessage = message as any; // Type assertion after isTextMessage() filter
                  return {
                    id: message.id,
                    role: textMessage.role as ChatMessage["role"],
                    content: textMessage.content?.toString() || "",
                  };
                }),
            },
          }),
        });
      }
    }, [visibleMessages, getTabById, tabId, updateTabData]);

    return (
      <CopilotChat
        Input={SyncedChatInput}
        AssistantMessage={(props) => {
          const isStreaming = props.isLoading || props.isGenerating;
          const content = props.rawData?.content?.toString() ?? "";

          // Check if response is an error
          const isError = content.startsWith("[ERROR]");
          let parsedError = null;
          if (isError) {
            try {
              const parsed = JSON.parse(content.replace("[ERROR]", ""));
              // Validate parsed error has expected shape
              if (
                typeof parsed === "object" &&
                parsed !== null &&
                typeof parsed.type === "string" &&
                typeof parsed.message === "string"
              ) {
                parsedError = parsed;
              } else {
                parsedError = { type: "unknown", message: content };
              }
            } catch {
              parsedError = { type: "unknown", message: content };
            }
          }

          return (
            <>
              <DeletableMessage
                messageId={props.rawData.id}
                onDelete={deleteMessage}
              >
                {isError && parsedError ? (
                  <ErrorMessage error={parsedError} />
                ) : (
                  <StructuredOutputDisplay
                    content={content}
                    isStreaming={isStreaming}
                  >
                    <AssistantMessage {...props} />
                  </StructuredOutputDisplay>
                )}
              </DeletableMessage>
              {!isStreaming && (
                <TraceMessage traceId={props.rawData.id} marginTop={2} />
              )}
            </>
          );
        }}
        UserMessage={(props) => {
          return (
            <DeletableMessage
              messageId={props.rawData.id}
              onDelete={deleteMessage}
            >
              <UserMessage {...props} />
            </DeletableMessage>
          );
        }}
      />
    );
  },
);

export { PromptPlaygroundChat };
