/**
 * Runs a prompt from the playground and streams the reply back.
 *
 * Replaces `useCopilotChat` and the GraphQL runtime behind it. The conversation
 * is a plain `ChatMessage[]` — the same shape the tab store already persists and
 * the shared renderer already reads — so there is no message class to convert
 * into and back out of.
 *
 * Deltas are buffered and flushed on an animation frame (`useDeltaBuffer`). The
 * previous arrangement re-rendered per token AND re-persisted the whole
 * conversation to localStorage per token, which is what the old component's
 * dedup-key comment was working around.
 */
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import {
  type PlaygroundStreamEvent,
  PROMPT_EXECUTE_ENDPOINT,
} from "~/prompts/prompt-playground/executeContract";
import type { runtimeInputsSchema } from "~/prompts/schemas/field-schemas";
import type { PromptConfigFormValues } from "~/prompts/types";
import type { ChatMessage } from "~/server/tracer/types";
import type { ParsedLLMError } from "~/utils/formatLLMError";
import { fetchSSE } from "~/utils/sse/fetchSSE";
import { useConversationState } from "./useConversationState";
import { useDeltaBuffer } from "./useDeltaBuffer";

/** A conversation entry as the playground holds and persists it. */
export type PlaygroundMessage = ChatMessage & { id: string; trace_id?: string };

interface UsePromptExecutionArgs {
  projectId: string | undefined;
  formValues: PromptConfigFormValues;
  variables: z.infer<typeof runtimeInputsSchema> | undefined;
  /** Conversation restored from the tab, applied once per tab. */
  initialMessages: PlaygroundMessage[];
  /** Persists the conversation so a refresh restores it. */
  onMessagesChange: (messages: PlaygroundMessage[]) => void;
}

export interface PromptExecution {
  messages: PlaygroundMessage[];
  /** Failed turns, keyed by the message id that would have held the reply. */
  errors: Record<string, ParsedLLMError>;
  isRunning: boolean;
  send: (content: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
  deleteMessage: (id: string) => void;
  setMessages: (messages: PlaygroundMessage[]) => void;
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The conversation as the server wants it: role and text only.
 *
 * A message whose content is not a string is one the server has no template
 * slot for — an image turn loaded from a trace — so it is left out rather than
 * stringified into the prompt.
 */
function toWireHistory(
  messages: PlaygroundMessage[],
): Array<{ role: string; content: string }> {
  return messages
    .filter((message) => typeof message.content === "string")
    .map((message) => ({
      role: message.role ?? "user",
      content: message.content as string,
    }));
}

/**
 * Opens the execution stream and reports what arrives.
 *
 * Kept outside the hook so the transport is readable on its own, and so the
 * hook is left holding only React state.
 */
async function streamExecution({
  payload,
  signal,
  onStart,
  onDelta,
  onFailure,
}: {
  payload: unknown;
  signal: AbortSignal;
  onStart: (event: { messageId: string; traceId: string }) => void;
  onDelta: (content: string) => void;
  onFailure: (error: ParsedLLMError) => void;
}): Promise<void> {
  await fetchSSE<PlaygroundStreamEvent>({
    endpoint: PROMPT_EXECUTE_ENDPOINT,
    signal,
    timeout: 20_000,
    payload,
    onEvent: (event) => {
      if (event.type === "start") {
        onStart({ messageId: event.messageId, traceId: event.traceId });
      } else if (event.type === "delta") {
        onDelta(event.content);
      } else if (event.type === "error") {
        onFailure(event.error);
      }
    },
    shouldStopProcessing: (event) => event.type === "done",
  });
}

export function usePromptExecution({
  projectId,
  formValues,
  variables,
  initialMessages,
  onMessagesChange,
}: UsePromptExecutionArgs): PromptExecution {
  const conversation = useConversationState({
    initialMessages,
    onMessagesChange,
  });
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const buffer = useDeltaBuffer(({ id, content }) =>
    conversation.update((current) =>
      current.map((message) =>
        message.id === id ? { ...message, content } : message,
      ),
    ),
  );

  // The form is read at send time, not at render time: a user who edits the
  // prompt mid-stream should not retroactively change the run in flight.
  const formValuesRef = useRef(formValues);
  formValuesRef.current = formValues;
  const variablesRef = useRef(variables);
  variablesRef.current = variables;

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useRunPrompt({ projectId, formValuesRef, variablesRef });

  const send = useCallback(
    async (content: string) => {
      if (!projectId || !content.trim() || isRunning) return;

      const history: PlaygroundMessage[] = [
        ...conversation.messages,
        { id: `user_${nanoid(8)}`, role: "user", content },
      ];
      conversation.commit(history);
      setIsRunning(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await run({ history, signal: controller.signal, conversation, buffer });
      } finally {
        buffer.cancel();
        abortRef.current = null;
        setIsRunning(false);
      }
    },
    [projectId, isRunning, conversation, buffer, run],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    conversation.clear();
  }, [conversation]);

  return {
    messages: conversation.messages,
    errors: conversation.errors,
    isRunning,
    send,
    stop,
    reset,
    deleteMessage: conversation.deleteMessage,
    setMessages: conversation.commit,
  };
}

/**
 * One run, from opening the stream to settling the reply.
 *
 * Returned as a callback rather than inlined so `usePromptExecution` reads as
 * what it is — state, plus a thing you can start.
 */
function useRunPrompt({
  projectId,
  formValuesRef,
  variablesRef,
}: {
  projectId: string | undefined;
  formValuesRef: { current: PromptConfigFormValues };
  variablesRef: { current: z.infer<typeof runtimeInputsSchema> | undefined };
}) {
  return useCallback(
    async ({
      history,
      signal,
      conversation,
      buffer,
    }: {
      history: PlaygroundMessage[];
      signal: AbortSignal;
      conversation: ReturnType<typeof useConversationState>;
      buffer: ReturnType<typeof useDeltaBuffer>;
    }) => {
      let assistantId: string | null = null;
      let accumulated = "";

      const openReply = ({
        messageId,
        traceId,
      }: {
        messageId: string;
        traceId: string;
      }) => {
        assistantId = messageId;
        accumulated = "";
        buffer.begin(messageId);
        conversation.update((current) => [
          ...current,
          { id: messageId, role: "assistant", content: "", trace_id: traceId },
        ]);
      };

      try {
        await streamExecution({
          signal,
          payload: {
            projectId,
            formValues: formValuesRef.current,
            variables: variablesRef.current ?? [],
            messages: toWireHistory(history),
          },
          onStart: openReply,
          onDelta: (delta) => {
            if (!assistantId) return;
            accumulated += delta;
            buffer.set(accumulated);
          },
          onFailure: (failure) => {
            if (assistantId) conversation.recordFailure(assistantId, failure);
          },
        });
      } catch (error) {
        // The stream never opened, or died mid-flight. `parseLLMError` never
        // ran on this path, so it is unknown and the error registry writes the
        // sentence. A run that failed before `start` has no turn to attach to,
        // so one is opened to hold the failure.
        if (!assistantId) {
          openReply({ messageId: `assistant_${nanoid(8)}`, traceId: "" });
        }
        conversation.recordFailure(assistantId!, {
          type: "unknown",
          message: describe(error),
        });
      } finally {
        conversation.settle({ assistantId, content: accumulated });
      }
    },
    [projectId, formValuesRef, variablesRef],
  );
}
