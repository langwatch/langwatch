import { useCallback, useRef, useState } from "react";
import type { ParsedLLMError } from "~/utils/formatLLMError";
import type { PlaygroundMessage } from "./usePromptExecution";

/**
 * The conversation a playground tab is holding, and the failures against it.
 *
 * Separate from running a prompt: this owns what is on screen and what gets
 * persisted, and knows nothing about streams. `usePromptExecution` composes
 * the two.
 */
export interface ConversationState {
  messages: PlaygroundMessage[];
  errors: Record<string, ParsedLLMError>;
  /** Replaces the conversation and persists it. */
  commit: (messages: PlaygroundMessage[]) => void;
  /** Updates the conversation without persisting — for a reply mid-stream. */
  update: (
    updater: (current: PlaygroundMessage[]) => PlaygroundMessage[],
  ) => void;
  recordFailure: (id: string, error: ParsedLLMError) => void;
  deleteMessage: (id: string) => void;
  clear: () => void;
  /** Writes the run's final content and persists once. */
  settle: (args: { assistantId: string | null; content: string }) => void;
}

export function useConversationState({
  initialMessages,
  onMessagesChange,
}: {
  initialMessages: PlaygroundMessage[];
  onMessagesChange: (messages: PlaygroundMessage[]) => void;
}): ConversationState {
  const [messages, setMessages] =
    useState<PlaygroundMessage[]>(initialMessages);
  const [errors, setErrors] = useState<Record<string, ParsedLLMError>>({});

  /**
   * The current conversation, readable from an event handler.
   *
   * Every write below computes its next value from this ref and then sets
   * state, rather than computing inside a `setMessages` updater. React
   * requires updaters to be pure, and these writes persist — under React 19's
   * Strict Mode the updater is invoked twice in development, and concurrent
   * rendering may replay it, so the persist call fired more than once per
   * change. It is idempotent today; this stops it depending on that.
   */
  const messagesRef = useRef<PlaygroundMessage[]>(initialMessages);

  const write = useCallback(
    (next: PlaygroundMessage[], { persist }: { persist: boolean }) => {
      messagesRef.current = next;
      setMessages(next);
      if (persist) onMessagesChange(next);
    },
    [onMessagesChange],
  );

  const commit = useCallback(
    (next: PlaygroundMessage[]) => write(next, { persist: true }),
    [write],
  );

  const update = useCallback(
    (updater: (current: PlaygroundMessage[]) => PlaygroundMessage[]) =>
      write(updater(messagesRef.current), { persist: false }),
    [write],
  );

  const recordFailure = useCallback((id: string, error: ParsedLLMError) => {
    setErrors((current) => ({ ...current, [id]: error }));
  }, []);

  const deleteMessage = useCallback(
    (id: string) => {
      setErrors((current) => {
        if (!(id in current)) return current;
        const { [id]: _removed, ...rest } = current;
        return rest;
      });
      commit(messagesRef.current.filter((message) => message.id !== id));
    },
    [commit],
  );

  const clear = useCallback(() => {
    setErrors({});
    commit([]);
  }, [commit]);

  const settle = useCallback(
    ({
      assistantId,
      content,
    }: {
      assistantId: string | null;
      content: string;
    }) => {
      const current = messagesRef.current;
      commit(
        assistantId
          ? current.map((message) =>
              message.id === assistantId ? { ...message, content } : message,
            )
          : current,
      );
    },
    [commit],
  );

  return {
    messages,
    errors,
    commit,
    update,
    recordFailure,
    deleteMessage,
    clear,
    settle,
  };
}
