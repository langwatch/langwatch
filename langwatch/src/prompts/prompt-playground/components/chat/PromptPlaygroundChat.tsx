import { Box, type BoxProps } from "@chakra-ui/react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import {
  AssistantMessage,
  CopilotChat,
  UserMessage,
} from "@copilotkit/react-ui";
import clsx from "clsx";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
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
 * Stable dedup key over the messages-to-persist projection. Encodes
 * each entry's id, role, and content length so streaming content
 * deltas trigger a re-persist (only ID-based dedup short-circuited
 * the latest assistant's chunks and left it stuck at empty content
 * across refreshes — see the effect comment in PromptPlaygroundChatInner).
 * Exported for unit testing.
 */
export function persistedMessagesKey(
  persisted: { id: string; role: ChatMessage["role"]; content: string }[],
): string {
  return persisted
    .map((m) => `${m.id}:${m.role}:${m.content.length}`)
    .join("|");
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
        onError={(error: unknown) => {
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
    const { setMessages, visibleMessages = [] } = useCopilotChat();
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
     * Sync the visible messages to the tab data so a browser refresh
     * restores the running conversation. Deduping by message ID alone
     * dropped the latest assistant reply: the assistant message gets a
     * stable ID the moment streaming starts (when content is still
     * empty), the ID-set never changes again for that turn, so the
     * effect skipped every content delta. The persisted snapshot ended
     * up with the most recent assistant message stuck at empty content
     * — which `convertScenarioMessagesToCopilotKit` then dropped on
     * reload via its `if (message.content && message.content !== "None")`
     * guard. Keying on a content snapshot too means each streaming
     * chunk re-persists the latest message; the per-turn writes are a
     * few dozen small localStorage updates which is fine.
     */
    const prevMessagesKeyRef = useRef("");
    useEffect(() => {
      if (!visibleMessages) return;
      const persisted = visibleMessages
        .filter((message) => message.isTextMessage())
        .map((message) => {
          const textMessage = message as any; // Type assertion after isTextMessage() filter
          return {
            id: message.id,
            role: textMessage.role as ChatMessage["role"],
            content: textMessage.content?.toString() || "",
          };
        });
      const messagesKey = persistedMessagesKey(persisted);
      if (messagesKey === prevMessagesKeyRef.current) return;
      prevMessagesKeyRef.current = messagesKey;

      const tab = getTabById(tabId);
      if (tab) {
        updateTabData({
          tabId,
          updater: (data) => ({
            ...(data || {}),
            chat: {
              ...(data?.chat || {}),
              initialMessagesFromSpanData: persisted,
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
