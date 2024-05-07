import { DragHandleIcon } from "@chakra-ui/icons";
import {
  Avatar,
  AvatarBadge,
  Box,
  Button,
  Checkbox,
  HStack,
  Input,
  InputGroup,
  InputRightElement,
  Spacer,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useChat, type Message } from "ai/react";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  MinusCircle,
  Plus,
  PlusCircle,
  RotateCcw,
  RotateCw,
  Send,
  X,
} from "react-feather";
import { useDebounceValue } from "usehooks-ts";
import { DashboardLayout } from "../../components/DashboardLayout";
import {
  modelOptions,
  usePlaygroundStore,
} from "../../hooks/usePlaygroundStore";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export default function Playground() {
  return (
    <DashboardLayout>
      <PlaygroundTabs />
    </DashboardLayout>
  );
}

function PlaygroundTabs() {
  const state = usePlaygroundStore((state) => {
    return {
      tabs: state.tabs.map(({ name, chatWindows }) => ({
        name,
        chatWindows: chatWindows.map(({ id }) => ({ id })),
      })),
      activeTabIndex: state.activeTabIndex,
      addNewTab: state.addNewTab,
      selectTab: state.selectTab,
      closeTab: state.closeTab,
    };
  });
  const { undo, redo, pastStates, futureStates } =
    usePlaygroundStore.temporal.getState();

  return (
    <>
      <Tabs
        colorScheme="orange"
        width="full"
        height="calc(100vh - 115px)"
        backgroundColor="white"
        paddingTop={4}
        index={state.activeTabIndex}
        onChange={(index) => {
          if (index >= state.tabs.length) {
            state.addNewTab();
          } else {
            state.selectTab(index);
          }
        }}
      >
        <HStack width="full">
          <Box overflowX="auto" paddingBottom="9px" marginBottom="-9px">
            <TabList>
              {state.tabs.map((tab, index) => (
                <Tab key={index}>
                  <HStack spacing={3}>
                    <Text whiteSpace="nowrap">{tab.name}</Text>
                    {state.tabs.length > 1 &&
                      index === state.activeTabIndex && (
                        <Box
                          role="button"
                          borderRadius="8px"
                          transition="background 0.1s"
                          paddingX={1}
                          onClick={() => state.closeTab(index)}
                          color={
                            index === state.activeTabIndex
                              ? "orange.400"
                              : "gray.500"
                          }
                          _hover={{ background: "gray.50" }}
                        >
                          <X width="16px" />
                        </Box>
                      )}
                  </HStack>
                </Tab>
              ))}
              <Tab>
                <Plus width="16px" />
              </Tab>
            </TabList>
          </Box>
          <Spacer />
          <HStack spacing={0} paddingRight={3}>
            <Button
              color="gray.500"
              size="xs"
              variant="ghost"
              onClick={() => undo()}
              isDisabled={pastStates.length === 0}
            >
              <RotateCcw width="16px" />
            </Button>
            <Button
              color="gray.500"
              size="xs"
              variant="ghost"
              onClick={() => redo()}
              isDisabled={futureStates.length === 0}
            >
              <RotateCw width="16px" />
            </Button>
          </HStack>
        </HStack>

        <TabPanels height="full" minHeight={0}>
          {state.tabs.map((tab, tabIndex) => (
            <PlaygroundTab
              key={tabIndex}
              chatWindows={tab.chatWindows}
              tabIndex={tabIndex}
            />
          ))}
        </TabPanels>
      </Tabs>
    </>
  );
}

function PlaygroundTab({
  chatWindows,
  tabIndex,
}: {
  chatWindows: { id: string }[];
  tabIndex: number;
}) {
  const reorderChatWindows = usePlaygroundStore(
    (state) => state.reorderChatWindows
  );
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  return (
    <TabPanel
      key={tabIndex}
      padding={0}
      height="full"
      minHeight={0}
      background="gray.100"
      outline="1px solid"
      outlineColor="gray.200"
    >
      <HStack spacing={0} overflowX="auto" height="full" minHeight={0}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event) => {
            const { active, over } = event;
            const windowIds = chatWindows.map((chat) => chat.id);
            const oldIndex = windowIds.indexOf(active.id as string);
            const newIndex = windowIds.indexOf(over!.id as string);
            const newOrder = arrayMove(windowIds, oldIndex, newIndex);
            reorderChatWindows(newOrder);
          }}
        >
          <SortableContext
            items={chatWindows.map((chat) => chat.id)}
            strategy={horizontalListSortingStrategy}
          >
            {chatWindows.map((chatWindow, windowIndex) => (
              <ChatWindowWrapper
                key={chatWindow.id}
                tabIndex={tabIndex}
                windowId={chatWindow.id}
                windowIndex={windowIndex}
              />
            ))}
          </SortableContext>
        </DndContext>
      </HStack>
    </TabPanel>
  );
}

const useChatWithSubscription = (id: string, model: string) => {
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

type ChatRef = ReturnType<typeof useChatWithSubscription>;

const ChatWindowWrapper = React.memo(function ChatWindowWrapper({
  tabIndex,
  windowId,
  windowIndex,
}: {
  tabIndex: number;
  windowId: string;
  windowIndex: number;
}) {
  const { id, model } = usePlaygroundStore((state) => {
    const { id, model } = state.tabs[tabIndex]!.chatWindows.find(
      (window) => window.id === windowId
    )!;

    return { id, model };
  });

  const chat = useChatWithSubscription(id, model.value);
  const chatRef = useRef<ChatRef>(chat);

  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);

  return (
    <ChatWindow
      tabIndex={tabIndex}
      windowId={windowId}
      windowIndex={windowIndex}
      chatRef={chatRef}
      addMessagesListener={chat.addMessagesListener}
      removeMessagesListener={chat.removeMessagesListener}
    />
  );
});

const ChatWindow = React.memo(function ChatWindow({
  tabIndex,
  windowId,
  windowIndex,
  chatRef,
  addMessagesListener,
  removeMessagesListener,
}: {
  tabIndex: number;
  windowId: string;
  windowIndex: number;
  chatRef: React.MutableRefObject<ChatRef>;
  addMessagesListener: (listener: (messages: Message[]) => void) => void;
  removeMessagesListener: (listener: (messages: Message[]) => void) => void;
}) {
  const {
    chatWindowState,
    addChatWindow,
    removeChatWindow,
    syncInputs,
    toggleSyncInputs,
    onChangeInput,
    onSubmit,
  } = usePlaygroundStore((state) => {
    const { id, model, input, requestedSubmission } = state.tabs[
      tabIndex
    ]!.chatWindows.find((chatWindow) => chatWindow.id === windowId)!;

    return {
      chatWindowState: { id, model, input, requestedSubmission },
      addChatWindow: state.addChatWindow,
      removeChatWindow: state.removeChatWindow,
      setModel: state.setModel,
      syncInputs: state.syncInputs,
      toggleSyncInputs: state.toggleSyncInputs,
      onChangeInput: state.onChangeInput,
      onSubmit: state.onSubmit,
      setMessages: state.setMessages,
    };
  });
  const [isFocused, setIsFocused] = useDebounceValue(false, 200);
  const inputRef = useRef<HTMLInputElement>(null);
  const undoHistory = usePlaygroundStore.temporal.getState();

  useEffect(() => {
    const simulatedEvent = {
      target: { value: chatWindowState.input },
    } as React.ChangeEvent<HTMLInputElement>;

    chatRef.current.handleInputChange(simulatedEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatWindowState?.input]);

  useEffect(() => {
    if (!chatWindowState) return;

    if (chatWindowState.requestedSubmission) {
      const simulatedSubmissionEvent = {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        preventDefault: () => {},
      } as React.FormEvent<HTMLFormElement>;
      chatRef.current.handleSubmit(simulatedSubmissionEvent);
      onSubmit(windowId, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatWindowState.requestedSubmission]);

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: chatWindowState.id });

  return (
    <VStack
      minWidth="442px"
      maxWidth="442px"
      height="full"
      minHeight={0}
      border="1px solid"
      borderColor="gray.200"
      marginLeft="-1px"
      marginTop="-1px"
      background="white"
      spacing={0}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      ref={setNodeRef}
    >
      <HStack
        width="100%"
        backgroundColor="gray.50"
        outline="1px solid"
        outlineColor="gray.200"
        padding={2}
      >
        <DragHandleIcon
          width="14px"
          height="14px"
          color="gray.350"
          {...attributes}
          {...listeners}
          cursor="move"
        />
        <SelectModel tabIndex={tabIndex} windowId={windowId} />
        <Spacer />
        <HStack spacing={0}>
          <Button
            size="xs"
            color="gray.500"
            variant="ghost"
            padding="6px"
            onClick={() => removeChatWindow(windowId)}
          >
            <MinusCircle width="18px" height="18px" />
          </Button>
          <Button
            size="xs"
            color="gray.500"
            variant="ghost"
            padding="6px"
            onClick={addChatWindow}
          >
            <PlusCircle width="18px" height="18px" />
          </Button>
        </HStack>
      </HStack>
      <VStack width="full" height="full" minHeight={0}>
        <Messages
          tabIndex={tabIndex}
          windowId={windowId}
          chatRef={chatRef}
          addMessagesListener={addMessagesListener}
          removeMessagesListener={removeMessagesListener}
        />

        <Box
          padding={4}
          background="gray.50"
          width="full"
          outline="1px solid"
          outlineColor="gray.200"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();

              onSubmit(windowId, true);
            }}
          >
            <InputGroup>
              <Input
                autoFocus={windowIndex === 0}
                value={chatWindowState.input}
                onChange={(e) => {
                  undoHistory.pause();
                  onChangeInput(windowId, e.target.value);
                  undoHistory.resume();
                }}
                placeholder="Say something..."
                background="white"
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                ref={inputRef}
              />
              <InputRightElement
                width="100px"
                justifyContent="end"
                paddingRight={2}
              >
                <HStack spacing={2}>
                  {isFocused && (
                    <Checkbox
                      size="sm"
                      isChecked={syncInputs}
                      onChange={(e) => {
                        inputRef.current?.focus();
                        e.stopPropagation();
                        toggleSyncInputs();
                      }}
                    >
                      <Text color="gray.400" fontSize="13px">
                        Sync
                      </Text>
                    </Checkbox>
                  )}
                  <Button
                    type="submit"
                    size="xs"
                    variant="ghost"
                    color="gray.400"
                    minWidth="16px"
                    minHeight="16px"
                  >
                    <Send width="16px" height="16px" />
                  </Button>
                </HStack>
              </InputRightElement>
            </InputGroup>
          </form>
        </Box>
      </VStack>
    </VStack>
  );
});

const SelectModel = React.memo(function SelectModel({
  tabIndex,
  windowId,
}: {
  tabIndex: number;
  windowId: string;
}) {
  const { model, setModel } = usePlaygroundStore((state) => {
    const { model } = state.tabs[tabIndex]!.chatWindows.find(
      (window) => window.id === windowId
    )!;

    return {
      model,
      setModel: state.setModel,
    };
  });

  return (
    <MultiSelect
      className="fix-hidden-inputs"
      value={model}
      onChange={(value) => value && setModel(windowId, value)}
      options={modelOptions}
      isSearchable={false}
      chakraStyles={{
        container: (base) => ({
          ...base,
          background: "white",
          width: "250px",
          borderRadius: "5px",
          padding: 0,
        }),
        valueContainer: (base) => ({
          ...base,
          padding: "0px 8px",
        }),
        control: (base) => ({
          ...base,
          minHeight: 0,
          height: "32px",
        }),
        dropdownIndicator: (provided) => ({
          ...provided,
          background: "white",
          padding: 0,
          paddingRight: 2,
          width: "auto",
          border: "none",
        }),
        indicatorSeparator: (provided) => ({
          ...provided,
          display: "none",
        }),
      }}
      components={{
        Option: ({ children, ...props }) => (
          <chakraComponents.Option {...props}>
            <HStack spacing={2} align="center">
              <Box width="14px">{props.data.icon}</Box>
              <Box fontSize={12} fontFamily="mono">
                {children}
              </Box>
              <Text fontSize={12} fontFamily="mono" color="gray.400">
                ({props.data.version})
              </Text>
            </HStack>
          </chakraComponents.Option>
        ),
        ValueContainer: ({ children, ...props }) => {
          const { getValue } = props;
          const value = getValue();
          const icon = value.length > 0 ? value[0]?.icon : null;
          const version = value.length > 0 ? value[0]?.version : null;

          return (
            <chakraComponents.ValueContainer {...props}>
              <HStack spacing={2} align="center">
                <Box width="14px">{icon}</Box>
                <Box fontSize={12} fontFamily="mono">
                  {children}
                </Box>
                <Text fontSize={12} fontFamily="mono" color="gray.400">
                  ({version})
                </Text>
              </HStack>
            </chakraComponents.ValueContainer>
          );
        },
      }}
    />
  );
});

function Messages({
  addMessagesListener,
  removeMessagesListener,
  chatRef,
  tabIndex,
  windowId,
}: {
  addMessagesListener: (listener: (messages: Message[]) => void) => void;
  removeMessagesListener: (listener: (messages: Message[]) => void) => void;
  chatRef: React.MutableRefObject<ChatRef>;
  tabIndex: number;
  windowId: string;
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
        console.log("first message");
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
        lastMessageElement.innerHTML = lastMessage.content;
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
      chatRef.current.setLocalMessages(messages);
    }
  }, [chatRef, messages]);

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
          <Text
            paddingTop="2px"
            whiteSpace="pre-wrap"
            id={`message-${message.id}`}
          >
            {message.content}
          </Text>
        </HStack>
      ))}
      <Box width="full" height="1px" id="messages-end" ref={messagesEndRef} />
    </VStack>
  );
}
