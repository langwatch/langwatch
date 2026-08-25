import { Box, type BoxProps, HStack, IconButton, Text } from "@chakra-ui/react";
import { forwardRef, useCallback, useImperativeHandle, useMemo } from "react";
import { LuCopy, LuTrash2 } from "react-icons/lu";
import type { z } from "zod";
import { ConversationThread } from "~/components/conversation/ConversationThread";
import { flattenMessages } from "~/components/conversation/flattenMessages";
import type { DisplayPart } from "~/components/conversation/types";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import type { runtimeInputsSchema } from "~/prompts/schemas/field-schemas";
import type { PromptConfigFormValues } from "~/prompts/types";
import {
  type PlaygroundMessage,
  usePromptExecution,
} from "../../hooks/usePromptExecution";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { useTabId } from "../prompt-browser/ui/TabContext";
import { playgroundConversationLabels } from "./conversationLabels";
import { renderPromptInstructions } from "./renderPromptInstructions";
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

/**
 * The playground's conversation.
 *
 * Renders through the shared `ConversationThread` — the same renderer the
 * simulations grid and drawer use — so a tool call looks the same wherever you
 * read one, and so the playground shows tool calls at all. The CopilotKit
 * runtime this replaced converted them faithfully and then rendered nothing,
 * because rendering an action execution needed a registered `useCopilotAction`
 * and there has never been one.
 */
const PromptPlaygroundChat = forwardRef<
  PromptPlaygroundChatRef,
  PromptPlaygroundChatProps
>(function PromptPlaygroundChat(props, ref) {
  const { formValues, variables, ...boxProps } = props;
  const { project } = useOrganizationTeamProject();
  const { data: session } = useRequiredSession();
  const tabId = useTabId();

  // The conversation is between this person and the model they picked, so it
  // says so. The label follows the picker, which means it names the model the
  // next reply will come from: a message carries no record of which model
  // wrote it, so switching models mid-session re-labels the replies already in
  // the thread as well.
  const model = formValues.version.configData.llm.model;
  const labels = useMemo(
    () =>
      playgroundConversationLabels({ userName: session?.user?.name, model }),
    [session?.user?.name, model],
  );

  const { getTabById, updateTabData } = useDraggableTabsBrowserStore(
    (state) => ({
      getTabById: state.getByTabId,
      updateTabData: state.updateTabData,
    }),
  );

  // Read once per tab: the store is where a refresh restores from, and the hook
  // owns the conversation from then on. Re-seeding on every store write would
  // fight the stream.
  const initialMessages = useMemo(
    () =>
      (getTabById(tabId)?.chat?.initialMessagesFromSpanData ??
        []) as PlaygroundMessage[],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed value, by tab
    [tabId],
  );

  const persist = useCallback(
    (messages: PlaygroundMessage[]) => {
      if (!getTabById(tabId)) return;
      updateTabData({
        tabId,
        updater: (data) => ({
          ...(data ?? {}),
          chat: {
            ...(data?.chat ?? {}),
            initialMessagesFromSpanData: messages,
          },
        }),
      });
    },
    [getTabById, tabId, updateTabData],
  );

  const execution = usePromptExecution({
    projectId: project?.id,
    formValues,
    variables,
    initialMessages,
    onMessagesChange: persist,
  });

  const { messages, errors, isRunning, send, stop, reset, deleteMessage } =
    execution;

  const renderedInstructions = useMemo(() => {
    const template =
      formValues.version.configData.messages?.find(
        (message) => message.role === "system",
      )?.content ?? "";
    const latestInput = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "user" && typeof message.content === "string",
      )?.content as string | undefined;

    return renderPromptInstructions({
      template,
      variables: variables ?? [],
      latestInput,
    });
  }, [formValues.version.configData.messages, messages, variables]);

  useImperativeHandle(ref, () => ({
    resetChat: reset,
    focusInput: () => {
      document
        .querySelector<HTMLTextAreaElement>(`textarea[data-tab-id="${tabId}"]`)
        ?.focus();
    },
  }));

  const parts = useMemo(
    () => flattenMessages({ messages, errors }),
    [messages, errors],
  );

  // The reply opens its turn the moment the first token lands, so the waiting
  // state is only for the gap before that: an assistant part at the end of the
  // thread means the answer is already arriving and drawing both would double
  // it up.
  const hasStreamingReply =
    parts.at(-1)?.kind === "text" &&
    (parts.at(-1) as Extract<DisplayPart, { kind: "text" }>).role ===
      "assistant";

  const renderPartActions = useCallback(
    (part: DisplayPart) => (
      <MessageActions part={part} onDelete={() => deleteMessage(part.id)} />
    ),
    [deleteMessage],
  );

  return (
    <Box
      width="full"
      height="full"
      display="flex"
      flexDirection="column"
      {...boxProps}
    >
      {/* Full width, so the thread's own scrollbar rides the panel edge; the
          messages are centred inside it by `panel.contentMaxWidth`. */}
      <Box
        flex={1}
        minHeight={0}
        width="full"
        display="flex"
        flexDirection="column"
      >
        {renderedInstructions.trim() && (
          <Box flexShrink={0} paddingX={4} paddingTop={4}>
            <Box
              width="full"
              maxWidth="768px"
              marginX="auto"
              paddingX={3}
              paddingY={2.5}
              borderWidth="1px"
              borderColor="purple.muted"
              borderRadius="lg"
              background="purple.subtle"
            >
              <Text
                textStyle="2xs"
                fontWeight="semibold"
                color="purple.fg"
                marginBottom={1}
              >
                Rendered instructions
              </Text>
              <Text
                fontSize="xs"
                color="fg.muted"
                whiteSpace="pre-wrap"
                maxHeight="88px"
                overflowY="auto"
              >
                {renderedInstructions}
              </Text>
            </Box>
          </Box>
        )}
        <Box flex={1} minHeight={0} width="full">
          <ConversationThread
            parts={parts}
            labels={labels}
            projectId={project?.id ?? ""}
            renderPartActions={renderPartActions}
            shouldRenderStructuredOutput
            panel={{ contentMaxWidth: "768px" }}
            live
            // The gap between sending and the first token belongs to the thread,
            // where the reply will land — not to the send button going quiet.
            hasPendingReply={isRunning && !hasStreamingReply}
          />
        </Box>
      </Box>
      <SyncedChatInput inProgress={isRunning} onSend={send} onStop={stop} />
    </Box>
  );
});

/**
 * Per-message actions, revealed with the pointer.
 *
 * Copy and delete are the two that were ever wired: the CopilotKit control row
 * also drew regenerate and thumbs buttons, whose handlers were never passed, so
 * three of its four buttons did nothing when clicked.
 */
function MessageActions({
  part,
  onDelete,
}: {
  part: DisplayPart;
  onDelete: () => void;
}) {
  const text = part.kind === "text" ? part.content : undefined;

  return (
    <HStack
      gap={0.5}
      opacity={0}
      transition="opacity 0.15s"
      _groupHover={{ opacity: 1 }}
      _focusWithin={{ opacity: 1 }}
    >
      {text && (
        <Tooltip content="Copy message">
          <IconButton
            aria-label="Copy message"
            size="2xs"
            variant="ghost"
            onClick={() => void navigator.clipboard.writeText(text)}
          >
            <LuCopy />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip content="Delete message">
        <IconButton
          aria-label="Delete message"
          size="2xs"
          variant="ghost"
          onClick={onDelete}
        >
          <LuTrash2 />
        </IconButton>
      </Tooltip>
    </HStack>
  );
}

export { PromptPlaygroundChat };
