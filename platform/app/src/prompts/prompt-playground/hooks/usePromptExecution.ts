/**
 * Runs a prompt from the playground and streams the reply back.
 *
 * Replaces `useCopilotChat` and the GraphQL runtime behind it. The conversation
 * is a plain `ChatMessage[]` — the same shape the tab store already persists and
 * the shared renderer already reads — so there is no message class to convert
 * into and back out of.
 *
 * Deltas are buffered and flushed on an animation frame. The previous
 * arrangement re-rendered per token AND re-persisted the whole conversation to
 * localStorage per token, which is what the old component's dedup-key comment
 * was working around.
 */
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { PlaygroundStreamEvent } from "~/app/api/prompt-playground/[[...route]]/app";
import type { runtimeInputsSchema } from "~/prompts/schemas/field-schemas";
import type { PromptConfigFormValues } from "~/prompts/types";
import type { ChatMessage } from "~/server/tracer/types";
import type { ParsedLLMError } from "~/utils/formatLLMError";
import { fetchSSE } from "~/utils/sse/fetchSSE";

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

export function usePromptExecution({
  projectId,
  formValues,
  variables,
  initialMessages,
  onMessagesChange,
}: UsePromptExecutionArgs): PromptExecution {
  const [messages, setMessagesState] =
    useState<PlaygroundMessage[]>(initialMessages);
  const [errors, setErrors] = useState<Record<string, ParsedLLMError>>({});
  const [isRunning, setIsRunning] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const frameRef = useRef<number | null>(null);
  const bufferRef = useRef<{ id: string; content: string } | null>(null);

  // The form is read at send time, not at render time: a user who edits the
  // prompt mid-stream should not retroactively change the run in flight.
  const formValuesRef = useRef(formValues);
  formValuesRef.current = formValues;
  const variablesRef = useRef(variables);
  variablesRef.current = variables;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const commit = useCallback(
    (next: PlaygroundMessage[]) => {
      setMessagesState(next);
      onMessagesChange(next);
    },
    [onMessagesChange],
  );

  /**
   * Folds buffered deltas into the streaming message on the next frame.
   *
   * Persistence deliberately does not run here — a partial reply is not worth a
   * localStorage write per frame, and the run's final flush covers a refresh.
   */
  const scheduleFlush = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const buffered = bufferRef.current;
      if (!buffered) return;
      setMessagesState((current) =>
        current.map((message) =>
          message.id === buffered.id
            ? { ...message, content: buffered.content }
            : message,
        ),
      );
    });
  }, []);

  const send = useCallback(
    async (content: string) => {
      if (!projectId || !content.trim() || isRunning) return;

      const history: PlaygroundMessage[] = [
        ...messages,
        { id: `user_${nanoid(8)}`, role: "user", content },
      ];
      commit(history);
      setIsRunning(true);

      const controller = new AbortController();
      abortRef.current = controller;

      let assistantId: string | null = null;
      let accumulated = "";

      const wireHistory = history
        .filter((message) => typeof message.content === "string")
        .map((message) => ({
          role: message.role ?? "user",
          content: message.content as string,
        }));

      try {
        await fetchSSE<PlaygroundStreamEvent>({
          endpoint: "/api/prompt-playground/execute",
          signal: controller.signal,
          timeout: 20_000,
          payload: {
            projectId,
            formValues: formValuesRef.current,
            variables: variablesRef.current ?? [],
            messages: wireHistory,
          },
          onEvent: (event) => {
            switch (event.type) {
              case "start": {
                assistantId = event.messageId;
                accumulated = "";
                bufferRef.current = { id: event.messageId, content: "" };
                setMessagesState((current) => [
                  ...current,
                  {
                    id: event.messageId,
                    role: "assistant",
                    content: "",
                    trace_id: event.traceId,
                  },
                ]);
                return;
              }
              case "delta": {
                if (!assistantId) return;
                accumulated += event.content;
                bufferRef.current = { id: assistantId, content: accumulated };
                scheduleFlush();
                return;
              }
              case "error": {
                if (assistantId) {
                  setErrors((current) => ({
                    ...current,
                    [assistantId!]: event.error,
                  }));
                }
                return;
              }
              case "done":
                return;
            }
          },
          shouldStopProcessing: (event) => event.type === "done",
        });
      } catch (error) {
        // The stream never opened, or died mid-flight. `parseLLMError` is not
        // reached in this path, so classify it as unknown and let the error
        // registry write the sentence.
        const id = assistantId ?? `assistant_${nanoid(8)}`;
        if (!assistantId) {
          setMessagesState((current) => [
            ...current,
            { id, role: "assistant", content: "" },
          ]);
        }
        setErrors((current) => ({
          ...current,
          [id]: {
            type: "unknown",
            message: error instanceof Error ? error.message : String(error),
          },
        }));
      } finally {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
        abortRef.current = null;
        setIsRunning(false);

        // One persist for the run, with whatever arrived — including a partial
        // reply from a stopped run, which the user asked to keep by stopping
        // rather than deleting.
        setMessagesState((current) => {
          const settled = assistantId
            ? current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: accumulated }
                  : message,
              )
            : current;
          onMessagesChange(settled);
          return settled;
        });
      }
    },
    [projectId, messages, isRunning, commit, scheduleFlush, onMessagesChange],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setErrors({});
    commit([]);
  }, [commit]);

  const deleteMessage = useCallback(
    (id: string) => {
      setErrors((current) => {
        if (!(id in current)) return current;
        const { [id]: _removed, ...rest } = current;
        return rest;
      });
      commit(messages.filter((message) => message.id !== id));
    },
    [commit, messages],
  );

  return {
    messages,
    errors,
    isRunning,
    send,
    stop,
    reset,
    deleteMessage,
    setMessages: commit,
  };
}
