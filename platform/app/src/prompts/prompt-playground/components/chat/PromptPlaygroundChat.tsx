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
import type { runtimeInputsSchema } from "~/prompts/schemas/field-schemas";
import type { PromptConfigFormValues } from "~/prompts/types";
import {
  type PlaygroundMessage,
  usePromptExecution,
} from "../../hooks/usePromptExecution";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { useTabId } from "../prompt-browser/ui/TabContext";
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
  const tabId = useTabId();

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
      <Box flex={1} minHeight={0} width="full" maxWidth="768px" margin="0 auto">
        <ConversationThread
          parts={parts}
          projectId={project?.id ?? ""}
          renderPartActions={renderPartActions}
          structuredOutput
        />
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Revealed on hover of the message, not of the row itself — a row that only
  // appears once you find it is not an affordance.
  useEffect(() => {
    const container = containerRef.current?.parentElement;
    if (!container) return;
    const show = () => containerRef.current?.style.setProperty("opacity", "1");
    const hide = () => containerRef.current?.style.setProperty("opacity", "0");
    container.addEventListener("mouseenter", show);
    container.addEventListener("mouseleave", hide);
    container.addEventListener("focusin", show);
    return () => {
      container.removeEventListener("mouseenter", show);
      container.removeEventListener("mouseleave", hide);
      container.removeEventListener("focusin", show);
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
