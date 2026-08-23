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

/**
 * The two ways the conversation is written, over one ref of what it holds.
 *
 * The ref is what makes them safe: each computes its next value from it and
 * then sets state, rather than computing inside a `setMessages` updater. React
 * requires updaters to be pure, and these writes persist — under React 19's
 * Strict Mode the updater runs twice in development, and concurrent rendering
 * may replay it, so the persist call fired more than once per change. It is
 * idempotent today; this stops it depending on that.
 */
function useMessageWriters({
  setMessages,
  initialMessages,
  onMessagesChange,
}: {
  setMessages: (messages: PlaygroundMessage[]) => void;
  initialMessages: PlaygroundMessage[];
  onMessagesChange: (messages: PlaygroundMessage[]) => void;
}) {
  const messagesRef = useRef<PlaygroundMessage[]>(initialMessages);

  const write = useCallback(
    (
      next: PlaygroundMessage[],
      { shouldPersist }: { shouldPersist: boolean },
    ) => {
      messagesRef.current = next;
      setMessages(next);
      if (shouldPersist) onMessagesChange(next);
    },
    [onMessagesChange, setMessages],
  );

  /** Replaces the conversation and persists it. */
  const commit = useCallback(
    (next: PlaygroundMessage[]) => write(next, { shouldPersist: true }),
    [write],
  );

  /** Updates it without persisting — for a reply still arriving. */
  const update = useCallback(
    (updater: (current: PlaygroundMessage[]) => PlaygroundMessage[]) =>
      write(updater(messagesRef.current), { shouldPersist: false }),
    [write],
  );

  return { messagesRef, commit, update };
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

  const { messagesRef, commit, update } = useMessageWriters({
    setMessages,
    initialMessages,
    onMessagesChange,
  });

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
