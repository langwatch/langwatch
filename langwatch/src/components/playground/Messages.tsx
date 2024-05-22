import {
  Avatar,
  AvatarBadge,
  Box,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { type Message } from "ai/react";
import React, { useCallback, useEffect, useRef } from "react";
import { usePlaygroundStore } from "../../hooks/usePlaygroundStore";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import type { ChatRef } from "../../hooks/useChatWithSubscription";
import { useDebounceValue } from "usehooks-ts";

export function Messages({
  addMessagesListener,
  removeMessagesListener,
  chatRef,
  tabIndex,
  windowId,
  error,
  isLoading,
}: {
  addMessagesListener: (listener: (messages: Message[]) => void) => void;
  removeMessagesListener: (listener: (messages: Message[]) => void) => void;
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
  const lastSetMessagesRef = useRef<Message[]>(messages);

  const setMessagesWithoutHistory = useCallback(
    (messages: Message[]) => {
      if (Object.is(messages, lastSetMessagesRef.current)) {
        return;
      }
      undoHistory.pause();
      setMessages(windowId, messages);
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
  const localMessagesRef = useRef<Message[]>(messages);
  const debouncedSetMessages = useCallback(
    (messages: Message[]) => {
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
    const listener = (localMessages: Message[]) => {
      const lastMessage = localMessages[localMessages.length - 1];
      const lastMessageElement = document.getElementById(
        `message-${lastMessage?.id}`
      );
      if (lastMessage && lastMessageElement) {
        lastMessageElement.textContent = lastMessage.content;
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
      chatRef.current.stop();
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
      spacing={0}
      borderTop="1px solid"
      borderColor="gray.200"
    >
      {messages.map((message, index) => (
        <MessageBlock key={message.id} message={message} index={index}>
          {message.role === "user" && (
            <Avatar
              size="xs"
              name={session?.user.name ?? ""}
              backgroundColor={"orange.400"}
              color="white"
              minWidth="22px"
              maxWidth="22px"
              height="22px"
              fontSize="8px"
            >
              <AvatarBadge boxSize="1.25em" bg="green.500" />
            </Avatar>
          )}
          {message.role === "assistant" && (
            <Box minWidth="22px" height="22px" padding="1px">
              {model.icon}
            </Box>
          )}
          <Text paddingTop="2px" whiteSpace="pre-wrap">
            <span id={`message-${message.id}`}>{message.content}</span>
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
              message={{ id: "loading", role: "assistant", content: "" }}
              index={messages.length}
            >
              <Box minWidth="22px" height="22px" padding="1px">
                {model.icon}
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
              message={{ id: "loading", role: "assistant", content: "" }}
              index={messages.length}
            >
              <Box minWidth="22px" height="22px" padding="1px">
                {model.icon}
              </Box>
              <Text paddingTop="2px" color="red.500">
                An error has occured
              </Text>
            </MessageBlock>
          )}
        </>
      )}
      <Box width="full" height="1px" id="messages-end" ref={messagesEndRef} />
    </VStack>
  );
}

function MessageBlock({
  message,
  index,
  children,
}: {
  message: Message;
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
      spacing={3}
    >
      {children}
    </HStack>
  );
}
