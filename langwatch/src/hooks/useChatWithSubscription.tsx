import { useChat, type Message } from "ai/react";
import { useCallback, useEffect, useRef, type FormEvent } from "react";

export const useChatWithSubscription = (id: string, model: string, systemPrompt: string) => {
  const {
    messages: localMessages,
    setMessages: setLocalMessages,
    handleInputChange,
    handleSubmit,
    error,
    isLoading,
    stop
  } = useChat({
    id: id,
    api: "/api/playground",
    headers: {
      "X-Model": model ?? "",
      "X-System-Prompt": systemPrompt ?? "",
    },
  });

  // Create an object as a ref that can be subscribed to with addEventListener and removeEventListener so that events using this won't trigger re-render as there is no hook change, but will be able to listen to new messages on the subscription
  const listeners = useRef<Set<(messages: Message[]) => void>>(new Set());
  const addMessagesListener = useCallback(
    (listener: (messages: Message[]) => void) => {
      listeners.current.add(listener);
    },
    []
  );
  const removeMessagesListener = useCallback(
    (listener: (messages: Message[]) => void) => {
      listeners.current.delete(listener);
    },
    []
  );

  const localMessagesRef = useRef(localMessages);
  useEffect(() => {
    localMessagesRef.current = localMessages;
  }, [localMessages]);

  const handleSubmitWithUpdate = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      stop();
      handleSubmit(e);
      listeners.current.forEach((listener) =>
        listener(localMessagesRef.current)
      );
    },
    [handleSubmit, stop]
  );

  const previousMessageRef = useRef<Message[]>([]);
  useEffect(() => {
    if (Object.is(previousMessageRef.current, localMessages)) {
      return;
    }
    previousMessageRef.current = localMessages;
    listeners.current.forEach((listener) => listener(localMessages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localMessages]);

  return {
    addMessagesListener,
    removeMessagesListener,
    setLocalMessages,
    handleInputChange,
    handleSubmit: handleSubmitWithUpdate,
    stop,
    error,
    isLoading
  };
};

export type ChatRef = ReturnType<typeof useChatWithSubscription>;
