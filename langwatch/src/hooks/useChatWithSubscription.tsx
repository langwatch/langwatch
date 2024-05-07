import { useChat, type Message } from "ai/react";
import { useCallback, useEffect, useRef, useState } from "react";


export const useChatWithSubscription = (id: string, model: string) => {
  const {
    messages: localMessages,
    setMessages: setLocalMessages,
    handleInputChange,
    handleSubmit,
  } = useChat({
    id: id,
    api: "/api/playground",
    headers: {
      "X-Model": model ?? "",
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

  const [skipUpdate, setSkipUpdate] = useState(false);
  const setLocalMessagesSkippingUpdate = useCallback(
    (messages: Message[]) => {
      setSkipUpdate(true);
      setLocalMessages(messages);
    },
    [setLocalMessages]
  );

  useEffect(() => {
    if (skipUpdate) {
      setSkipUpdate(false);
      return;
    }
    listeners.current.forEach((listener) => listener(localMessages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localMessages]);

  return {
    addMessagesListener,
    removeMessagesListener,
    setLocalMessages: setLocalMessagesSkippingUpdate,
    handleInputChange,
    handleSubmit,
  };
};

export type ChatRef = ReturnType<typeof useChatWithSubscription>;
