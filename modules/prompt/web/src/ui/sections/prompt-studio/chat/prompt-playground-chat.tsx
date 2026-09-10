import { Box, type BoxProps, HStack, IconButton } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { PromptConfigFormValues, runtimeInputsSchema } from "@langwatch/prompt-contract";
import {
  ConversationThread,
  type DisplayPart,
  flattenMessages,
} from "@langwatch/trace-web/surfaces/conversation";
import { forwardRef, useCallback, useImperativeHandle, useMemo } from "react";
import { LuCopy, LuTrash2 } from "react-icons/lu";
import type { z } from "zod";

import {
  type PlaygroundMessage,
  usePromptExecution,
} from "../../../../behavior/playground/use-prompt-execution.ts";
import { useDraggableTabsBrowserStore } from "../../../../behavior/use-prompt-tabs-browser-store.ts";
import { usePromptProject } from "../../../../behavior/use-prompt-project.ts";
import { usePromptHost } from "../../../../model/prompt-host.ts";
import { playgroundConversationLabels } from "../../../../model/playground-conversation-labels.ts";
import { useTabId } from "../studio-internals.ts";
import { PlaygroundTurnSeparator } from "./playground-turn-separator.tsx";
import { SyncedChatInput } from "./synced-chat-input.tsx";

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
 * Renders through the shared `ConversationThread` - the same renderer the
 * simulations grid and drawer use - so a tool call looks the same wherever you
 * read one, and so the playground shows tool calls at all. The CopilotKit
 * runtime this replaced converted them faithfully and then rendered nothing,
 * because rendering an action execution needed a registered `useCopilotAction`
 * and there has never been one.
 */
const PromptPlaygroundChat = forwardRef<PromptPlaygroundChatRef, PromptPlaygroundChatProps>(
  function PromptPlaygroundChat(props, ref) {
    const { formValues, variables, ...boxProps } = props;
    const { project } = usePromptProject();
    const host = usePromptHost();
    const tabId = useTabId();

    // The conversation is between this person and the model they picked, so it
    // says so. The label follows the picker, which means it names the model the
    // next reply will come from: a message carries no record of which model
    // wrote it, so switching models mid-session re-labels the replies already
    // in the thread as well.
    // A restored tab can hold a partial form while the editor rehydrates, so the
    // model is read defensively: an unnamed side falls back to its role label.
    const model = formValues.version?.configData?.llm?.model;
    const userName = host.currentUserName();
    const labels = useMemo(
      () => playgroundConversationLabels({ userName, model }),
      [userName, model],
    );

    const getTabById = useDraggableTabsBrowserStore((state) => state.getByTabId);
    const updateTabData = useDraggableTabsBrowserStore((state) => state.updateTabData);

    // Read once per tab: the store is where a refresh restores from, and the
    // hook owns the conversation from then on. Re-seeding on every store write
    // would fight the stream.
    const initialMessages = useMemo(
      () => (getTabById(tabId)?.chat?.initialMessagesFromSpanData ?? []) as PlaygroundMessage[],
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
            chat: { ...(data?.chat ?? {}), initialMessagesFromSpanData: messages },
          }),
        });
      },
      [getTabById, tabId, updateTabData],
    );

    const { messages, errors, isRunning, send, stop, reset, deleteMessage } = usePromptExecution({
      projectId: project?.id,
      formValues,
      variables,
      initialMessages,
      onMessagesChange: persist,
    });

    useImperativeHandle(ref, () => ({
      resetChat: reset,
      focusInput: () => {
        document.querySelector<HTMLTextAreaElement>(`textarea[data-tab-id="${tabId}"]`)?.focus();
      },
    }));

    const parts = useMemo(() => flattenMessages({ messages, errors }), [messages, errors]);

    // The reply opens its turn the moment the first token lands, so the waiting
    // state is only for the gap before that: an assistant part at the end of the
    // thread means the answer is already arriving and drawing both would double
    // it up.
    const last = parts.at(-1);
    const hasStreamingReply = last?.kind === "text" && last.role === "assistant";

    const renderPartActions = useCallback(
      (part: DisplayPart) => <MessageActions part={part} onDelete={() => deleteMessage(part.id)} />,
      [deleteMessage],
    );

    return (
      <Box width="full" height="full" display="flex" flexDirection="column" {...boxProps}>
        {/* Full width, so the thread's own scrollbar rides the panel edge; the
            messages are centred inside it by `panel.contentMaxWidth`. */}
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
            // where the reply will land - not to the send button going quiet.
            hasPendingReply={isRunning && !hasStreamingReply}
            renderMediaPart={() => null}
            renderTurnSeparator={(separator) => (
              <PlaygroundTurnSeparator
                index={separator.index}
                traceId={separator.traceId}
                live={separator.live}
              />
            )}
          />
        </Box>
        <SyncedChatInput inProgress={isRunning} onSend={send} onStop={stop} />
      </Box>
    );
  },
);

/**
 * The Clipboard API is absent on insecure origins and in some browsers, so
 * `navigator.clipboard` can be undefined and reading `.writeText` off it throws
 * synchronously - `void` catches nothing. A permission-denied write rejects
 * rather than throwing, so both paths need handling. Failure is silent: the
 * surface is an icon button with no room for an error string, and the reader
 * can still select the text by hand.
 */
function copyMessageText(text: string) {
  try {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  } catch {
    // Clipboard unavailable - nothing to fall back to from here.
  }
}

/**
 * Per-message actions, revealed with the pointer.
 *
 * Copy and delete are the two that were ever wired: the CopilotKit control row
 * also drew regenerate and thumbs buttons, whose handlers were never passed, so
 * three of its four buttons did nothing when clicked.
 */
function MessageActions({ part, onDelete }: { part: DisplayPart; onDelete: () => void }) {
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
            onClick={() => copyMessageText(text)}
          >
            <LuCopy />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip content="Delete message">
        <IconButton aria-label="Delete message" size="2xs" variant="ghost" onClick={onDelete}>
          <LuTrash2 />
        </IconButton>
      </Tooltip>
    </HStack>
  );
}

export { PromptPlaygroundChat };
