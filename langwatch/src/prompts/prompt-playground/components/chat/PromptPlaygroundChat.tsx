import { useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { AssistantMessage, CopilotChat } from "@copilotkit/react-ui";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompts/types";
import type { z } from "zod";
import { type runtimeInputsSchema } from "~/prompts/schemas/field-schemas";
import { SyncedChatInput } from "./SyncedChatInput";
import { TraceMessage } from "~/components/copilot-kit/TraceMessage";
import { DeletableMessage } from "./DeletableMessage";
import { Box, type BoxProps } from "@chakra-ui/react";
import clsx from "clsx";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { useTabId } from "../prompt-browser/ui/TabContext";
import { convertScenarioMessagesToCopilotKit } from "~/components/simulations/utils/convert-scenario-messages";
import type { ChatMessage } from "~/server/tracer/types";

interface PromptPlaygroundChatProps extends BoxProps {
  formValues: PromptConfigFormValues;
  variables?: z.infer<typeof runtimeInputsSchema>;
}

/**
 * PromptPlaygroundChatRef
 * Single Responsibility: Exposes imperative methods to control the chat instance (e.g., reset).
 */
export interface PromptPlaygroundChatRef {
  resetChat: () => void;
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
            ...data,
            chat: {
              ...data.chat,
              initialMessagesFromSpanData: visibleMessages
                .filter((message) => message.isTextMessage())
                .map((message) => ({
                  id: message.id,
                  role: message.role as ChatMessage["role"],
                  content: message.content.toString(),
                })),
            },
          }),
        });
      }
    }, [visibleMessages, getTabById, tabId, updateTabData]);

    return (
      <CopilotChat
        Input={SyncedChatInput}
        AssistantMessage={(props) => {
          return (
            <>
              <DeletableMessage
                messageId={props.rawData.id}
                onDelete={deleteMessage}
              >
                <AssistantMessage {...props} />
              </DeletableMessage>
              {!props.isLoading && !props.isGenerating && (
                <TraceMessage traceId={props.rawData.id} marginTop={2} />
              )}
            </>
          );
        }}
      />
    );
  },
);

export { PromptPlaygroundChat };
