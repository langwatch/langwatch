import { type UIMessage, useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { type FormEvent, useCallback, useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

export const useChatWithSubscription = (
  id: string,
  model: string,
  systemPrompt: string,
) => {
  const { project } = useOrganizationTeamProject();

  const {
    messages: localMessages,
    setMessages: setLocalMessages,
    sendMessage,
    error,
    status,
    stop,
  } = useChat({
    id: id,
    transport: new DefaultChatTransport({
      api: "/api/playground",
      headers: {
        "X-Model": model ?? "",
        "X-System-Prompt": encodeURIComponent(systemPrompt ?? ""),
        "X-Project-Id": project?.id ?? "",
      },
    }),
  });

  // Create an object as a ref that can be subscribed to with addEventListener and removeEventListener so that events using this won't trigger re-render as there is no hook change, but will be able to listen to new messages on the subscription
  const listeners = useRef<Set<(messages: UIMessage[]) => void>>(new Set());
  const addMessagesListener = useCallback(
    (listener: (messages: UIMessage[]) => void) => {
      listeners.current.add(listener);
    },
    [],
  );
  const removeMessagesListener = useCallback(
    (listener: (messages: UIMessage[]) => void) => {
      listeners.current.delete(listener);
    },
    [],
  );

  const localMessagesRef = useRef(localMessages);
  useEffect(() => {
    localMessagesRef.current = localMessages;
  }, [localMessages]);

  const handleSubmitWithUpdate = useCallback(
    async (message: string) => {
      await stop();
      void sendMessage({
        role: "user",
        parts: [{ type: "text", text: message }],
      });
      listeners.current.forEach((listener) =>
        listener(localMessagesRef.current),
      );
    },
    [sendMessage, stop],
  );

  const previousMessageRef = useRef<UIMessage[]>([]);
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
    handleSubmit: handleSubmitWithUpdate,
    stop,
    error,
    status,
  };
};

export type ChatRef = ReturnType<typeof useChatWithSubscription>;
