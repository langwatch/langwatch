import { Box, type BoxProps, HStack, IconButton } from "@chakra-ui/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
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
import { SyncedChatInput } from "./SyncedChatInput";
import type { ChatVariableField } from "./ui/ChatVariableFields";

interface PromptPlaygroundChatProps extends BoxProps {
  formValues: PromptConfigFormValues;
  variables?: z.infer<typeof runtimeInputsSchema>;
  /**
   * The variables the message box offers a field for — everything the run
   * substitutes except `input`, whose field is the message box itself.
   */
  composerVariables?: ChatVariableField[];
  /**
   * Sets one variable's value for the next run, from the message box.
   *
   * Required: its only caller passes it, and a variable row the customer can
   * type into that reports nothing is worse than no row at all.
   */
  onVariableValueChange: (identifier: string, value: string) => void;
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
  const {
    formValues,
    variables,
    composerVariables,
    onVariableValueChange,
    ...boxProps
  } = props;
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

  // Selected one at a time. A selector returning a fresh object is a new
  // reference on every store write, so this component re-rendered whenever any
  // tab anywhere changed.
  const getTabById = useDraggableTabsBrowserStore((state) => state.getByTabId);
  const updateTabData = useDraggableTabsBrowserStore(
    (state) => state.updateTabData,
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
      <Box flex={1} minHeight={0} width="full">
        <ConversationThread
          parts={parts}
          labels={labels}
          projectId={project?.id ?? ""}
          renderPartActions={renderPartActions}
          structuredOutput
          panel={{ contentMaxWidth: "768px" }}
          live
          // The gap between sending and the first token belongs to the thread,
          // where the reply will land — not to the send button going quiet.
          pendingReply={isRunning && !hasStreamingReply}
        />
      </Box>
      <SyncedChatInput
        inProgress={isRunning}
        onSend={send}
        onStop={stop}
        variables={composerVariables}
        onVariableValueChange={onVariableValueChange}
      />
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Revealed on hover of the message, not of the row itself — a row that only
  // appears once you find it is not an affordance.
  useEffect(() => {
    const container = containerRef.current?.parentElement;
    if (!container) return;
    const show = () => containerRef.current?.style.setProperty("opacity", "1");
    const hide = () => containerRef.current?.style.setProperty("opacity", "0");
    // `focusout` as well as `focusin`, or a keyboard user who tabbed into a
    // message left its action row at full opacity for the rest of the session:
    // no pointer ever entered, so no `mouseleave` was coming to hide it.
    // Focus moving between the row's own buttons stays inside the message, so
    // that is not a departure.
    const hideOnFocusLeaving = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && container.contains(next)) return;
      hide();
    };
    container.addEventListener("mouseenter", show);
    container.addEventListener("mouseleave", hide);
    container.addEventListener("focusin", show);
    container.addEventListener("focusout", hideOnFocusLeaving);
    return () => {
      container.removeEventListener("mouseenter", show);
      container.removeEventListener("mouseleave", hide);
      container.removeEventListener("focusin", show);
      container.removeEventListener("focusout", hideOnFocusLeaving);
    };
  }, []);

  return (
    <HStack ref={containerRef} gap={0.5} opacity={0} transition="opacity 0.15s">
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
