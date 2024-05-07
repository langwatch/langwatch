import { DragHandleIcon } from "@chakra-ui/icons";
import {
  Box,
  Button,
  Checkbox,
  HStack,
  Input,
  InputGroup,
  InputRightElement,
  Spacer,
  Text,
  VStack
} from "@chakra-ui/react";
import {
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type Message } from "ai/react";
import React, { useEffect, useRef } from "react";
import {
  MinusCircle,
  PlusCircle,
  Send
} from "react-feather";
import { useDebounceValue } from "usehooks-ts";
import {
  usePlaygroundStore
} from "../../hooks/usePlaygroundStore";
import { SelectModel } from "./SelectModel";
import { useChatWithSubscription, type ChatRef } from "../../hooks/useChatWithSubscription";
import { Messages } from "./Messages";


export const ChatWindowWrapper = React.memo(function ChatWindowWrapper({
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