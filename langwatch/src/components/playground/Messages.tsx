import { Avatar, Box, Text, VStack, HStack } from "@chakra-ui/react";
import { type UIMessage } from "@ai-sdk/react";
import React, { useCallback, useEffect, useRef } from "react";
import { usePlaygroundStore } from "../../hooks/usePlaygroundStore";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import type { ChatRef } from "../../hooks/useChatWithSubscription";
import { useDebounceValue } from "usehooks-ts";
import { modelSelectorOptions } from "../ModelSelector";

export function Messages({
  addMessagesListener,
  removeMessagesListener,
  chatRef,
  tabIndex,
  windowId,
  error,
  isLoading,
}: {
  addMessagesListener: (listener: (messages: UIMessage[]) => void) => void;
  removeMessagesListener: (listener: (messages: UIMessage[]) => void) => void;
  chatRef: React.MutableRefObject<ChatRef>;
  tabIndex: number;
  windowId: string;
  error: Error | undefined;
  isLoading: boolean;
}) {
  const { data: session } = useRequiredSession();
  const undoHistory = usePlaygroundStore.temporal.getState();

  const { model, messages, setMessages } = usePlaygroundStore((state) => {
    const { model, messages } = state.tabs[tabIndex]!.chatWindows.find(
      (window) => window.id === windowId
    )!;

    return {
      model,
      messages,
      setMessages: state.setMessages,
    };
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSetMessagesRef = useRef<UIMessage[]>(messages);

  const setMessagesWithoutHistory = useCallback(
    (messages: UIMessage[]) => {
      if (Object.is(messages, lastSetMessagesRef.current)) {
        return;
      }
      undoHistory.pause();
      setMessages(windowId, messages as any);
      lastSetMessagesRef.current = messages;
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({
          behavior: "instant",
        });
      }, 100);
      undoHistory.resume();
    },
    [setMessages, windowId, undoHistory]
  );

  const debounceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const localMessagesRef = useRef<UIMessage[]>(messages);
  const debouncedSetMessages = useCallback(
    (messages: UIMessage[]) => {
      localMessagesRef.current = messages;
      if (!debounceIntervalRef.current) {
        setMessagesWithoutHistory(messages);
      }
      const currentTimeout = setTimeout(() => {
        setMessagesWithoutHistory(localMessagesRef.current);
        if (Object.is(currentTimeout, debounceIntervalRef.current)) {
          debounceIntervalRef.current = null;
        }
      }, 200);
      debounceIntervalRef.current = currentTimeout;
    },
    [setMessagesWithoutHistory]
  );

  useEffect(() => {
    const listener = (localMessages: UIMessage[]) => {
      const lastMessage = localMessages[localMessages.length - 1];
      const lastMessageElement = document.getElementById(
        `message-${lastMessage?.id}`
      );
      if (lastMessage && lastMessageElement) {
        lastMessageElement.textContent = lastMessage.parts.find((part) => part.type === "text")?.text ?? "";
      }
      messagesEndRef.current?.scrollIntoView({
        behavior: "instant",
      });
      debouncedSetMessages(localMessages);
    };
    addMessagesListener(listener);

    return () => {
      removeMessagesListener(listener);
    };
  }, [
    addMessagesListener,
    setMessages,
    debouncedSetMessages,
    removeMessagesListener,
    windowId,
  ]);

  useEffect(() => {
    if (!Object.is(messages, lastSetMessagesRef.current)) {
      void chatRef.current.stop();
      chatRef.current.setLocalMessages(messages);
    }
  }, [chatRef, messages]);

  const lastMessage = messages[messages.length - 1];

  const [debouncedLoading, setDebouncedLoading] = useDebounceValue(
    isLoading,
    200
  );
  useEffect(() => {
    setDebouncedLoading(isLoading);
  }, [isLoading, setDebouncedLoading]);

  return (
    <VStack
      width="full"
      height="full"
      overflowY="auto"
      align="start"
      gap={0}
      borderTop="1px solid"
      borderColor="gray.200"
    >
      {messages.map((message, index) => (
        <MessageBlock key={message.id} message={message} index={index}>
          {message.role === "user" && (
            <Avatar.Root
              size="xs"
              backgroundColor={"orange.400"}
              color="white"
              minWidth="22px"
              maxWidth="22px"
              height="22px"
              fontSize="8px"
            >
              <Avatar.Fallback name={session?.user.name ?? ""} />
              <Box
                as="span"
                position="absolute"
                bottom="0"
                right="0"
                boxSize="1.25em"
                bg="green.500"
                borderRadius="full"
              />
            </Avatar.Root>
          )}
          {message.role === "assistant" && (
            <Box minWidth="22px" height="22px" padding="1px">
              {
                modelSelectorOptions.find((option) => option.value === model)
                  ?.icon
              }
            </Box>
          )}
          <Text paddingTop="2px" whiteSpace="pre-wrap">
            <span id={`message-${message.id}`}>
              {message.parts.find((part) => part.type === "text")?.text ?? ""}
            </span>
            {lastMessage?.role === "assistant" &&
              message.id === lastMessage.id &&
              debouncedLoading && <span className="chat-loading-circle" />}
            {lastMessage?.role === "assistant" &&
              message.id === lastMessage.id &&
              error && (
                <Text as="span" color="red.500">
                  {" "}
                  An error has occured
                </Text>
              )}
          </Text>
        </MessageBlock>
      ))}
      {(!lastMessage || (lastMessage && lastMessage.role !== "assistant")) && (
        <>
          {debouncedLoading && (
            <MessageBlock
              message={{ id: "loading", role: "assistant", parts: [{ type: "text", text: "" }] }}
              index={messages.length}
            >
              <Box minWidth="22px" height="22px" padding="1px">
                {
                  modelSelectorOptions.find((option) => option.value === model)
                    ?.icon
                }
              </Box>
              <Text paddingTop="2px">
                <span
                  className="chat-loading-circle"
                  style={{ marginLeft: 0 }}
                />
              </Text>
            </MessageBlock>
          )}
          {error && (
            <MessageBlock
              message={{ id: "loading", role: "assistant", parts: [{ type: "text", text: "" }] }}
              index={messages.length}
            >
              <Box minWidth="22px" height="22px" padding="1px">
                {
                  modelSelectorOptions.find((option) => option.value === model)
                    ?.icon
                }
              </Box>
              <ErrorMessage error={error} />
            </MessageBlock>
          )}
        </>
      )}
      <Box width="full" height="1px" id="messages-end" ref={messagesEndRef} />
    </VStack>
  );
}

function ErrorMessage({ error }: { error: Error }) {
  try {
    const json = JSON.parse(error.message);
    return (
      <Text paddingTop="2px" color="red.500">
        {typeof json.error === "string" ? json.error : JSON.stringify(json)}
      </Text>
    );
  } catch {
    return (
      <Text paddingTop="2px" color="red.500">
        {/* An error has occured */}
        {error.message}
      </Text>
    );
  }
}

function MessageBlock({
  message,
  index,
  children,
}: {
  message: UIMessage;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <HStack
      key={message.id}
      borderTop={index === 0 ? "none" : "1px solid"}
      borderColor="gray.200"
      padding={3}
      width="full"
      background={message.role === "user" ? "#FCFEFF" : "white"}
      align="start"
      fontSize="13px"
      gap={3}
    >
      {children}
    </HStack>
  );
}
