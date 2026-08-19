import { useCallback, useState } from "react";
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

  const commit = useCallback(
    (next: PlaygroundMessage[]) => {
      setMessages(next);
      onMessagesChange(next);
    },
    [onMessagesChange],
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
      setMessages((current) => {
        const next = current.filter((message) => message.id !== id);
        onMessagesChange(next);
        return next;
      });
    },
    [onMessagesChange],
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
      setMessages((current) => {
        const settled = assistantId
          ? current.map((message) =>
              message.id === assistantId ? { ...message, content } : message,
            )
          : current;
        onMessagesChange(settled);
        return settled;
      });
    },
    [onMessagesChange],
  );

  return {
    messages,
    errors,
    commit,
    update: setMessages,
    recordFailure,
    deleteMessage,
    clear,
    settle,
  };
}
