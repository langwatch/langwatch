import {
  Box,
  Button,
  HStack,
  Icon,
  Input,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type UIMessage } from "@ai-sdk/react";
import React, { useEffect, useRef } from "react";
import { ChevronDown, MinusCircle, PlusCircle, Send } from "react-feather";
import { LuGripVertical } from "react-icons/lu";
import { useDebounceValue } from "usehooks-ts";
import {
  useChatWithSubscription,
  type ChatRef,
} from "../../hooks/useChatWithSubscription";
import { usePlaygroundStore } from "../../hooks/usePlaygroundStore";
import { allModelOptions, ModelSelector } from "../ModelSelector";
import { Checkbox } from "../ui/checkbox";
import { InputGroup } from "../ui/input-group";
import { Messages } from "./Messages";

export const ChatWindowWrapper = React.memo(function ChatWindowWrapper({
  tabIndex,
  windowId,
  windowIndex,
  windowsCount,
}: {
  tabIndex: number;
  windowId: string;
  windowIndex: number;
  windowsCount: number;
}) {
  const { id, model, systemPrompt } = usePlaygroundStore((state) => {
    const { id, model, systemPrompt } = state.tabs[tabIndex]!.chatWindows.find(
      (window) => window.id === windowId
    )!;

    return { id, model, systemPrompt };
  });

  const chat = useChatWithSubscription(id, model, systemPrompt);
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
      error={chat.error}
      isLoading={!["ready", "error"].includes(chat.status)}
      windowsCount={windowsCount}
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
  error,
  isLoading,
  windowsCount,
}: {
  tabIndex: number;
  windowId: string;
  windowIndex: number;
  chatRef: React.RefObject<ChatRef>;
  addMessagesListener: (listener: (messages: UIMessage[]) => void) => void;
  removeMessagesListener: (listener: (messages: UIMessage[]) => void) => void;
  error: Error | undefined;
  isLoading: boolean;
  windowsCount: number;
}) {
  const {
    chatWindowState,
    addChatWindow,
    removeChatWindow,
    onSubmit,
    setModel,
  } = usePlaygroundStore((state) => {
    const { id, model, input, requestedSubmission } = state.tabs[
      tabIndex
    ]!.chatWindows.find((chatWindow) => chatWindow.id === windowId)!;

    return {
      chatWindowState: { id, model, input, requestedSubmission },
      addChatWindow: state.addChatWindow,
      removeChatWindow: state.removeChatWindow,
      onSubmit: state.onSubmit,
      setModel: state.setModel,
    };
  });

  // Note: handleInputChange is not available in the ChatRef interface
  // The input state is managed by the chat component internally

  useEffect(() => {
    if (!chatWindowState) return;

    if (chatWindowState.requestedSubmission) {
      // handleSubmit expects a string message, not a FormEvent
      // We need to pass the current input value
      if (chatWindowState.input) {
        void chatRef.current.handleSubmit(chatWindowState.input);
        onSubmit(windowId, false);
      }
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
      gap={0}
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
        <Icon
          {...attributes}
          {...listeners}
          cursor="move"
          width="14px"
          height="14px"
          color="gray.350"
        >
          <LuGripVertical />
        </Icon>
        <ModelSelector
          options={allModelOptions}
          model={chatWindowState.model}
          onChange={(model) => setModel(windowId, model)}
          size="sm"
          mode="chat"
        />
        <Spacer />
        <HStack gap={0}>
          <Button
            size="xs"
            color="gray.500"
            variant="ghost"
            padding="6px"
            onClick={() => removeChatWindow(windowId)}
            disabled={windowsCount === 1}
          >
            <MinusCircle width="18px" height="18px" />
          </Button>
          <Button
            size="xs"
            color="gray.500"
            variant="ghost"
            padding="6px"
            onClick={() => addChatWindow(windowId)}
            disabled={windowsCount >= 10}
          >
            <PlusCircle width="18px" height="18px" />
          </Button>
        </HStack>
      </HStack>
      <VStack width="full" height="full" minHeight={0} gap={0}>
        <ChatSystemPrompt tabIndex={tabIndex} windowId={windowId} />
        <Messages
          tabIndex={tabIndex}
          windowId={windowId}
          chatRef={chatRef}
          addMessagesListener={addMessagesListener}
          removeMessagesListener={removeMessagesListener}
          error={error}
          isLoading={isLoading}
        />
        <ChatInputBox
          windowId={windowId}
          windowIndex={windowIndex}
          chatWindowState={chatWindowState}
        />
      </VStack>
    </VStack>
  );
});

function ChatSystemPrompt({
  tabIndex,
  windowId,
}: {
  tabIndex: number;
  windowId: string;
}) {
  const {
    systemPromptExpanded,
    toggleSystemPromptExpanded,
    onChangeSystemPrompt,
    systemPrompt,
    syncSystemPrompts,
    toggleSyncSystemPrompts,
  } = usePlaygroundStore((state) => {
    const currentChatWindow = state.tabs[tabIndex]!.chatWindows.find(
      (chatWindow) => chatWindow.id === windowId
    )!;

    return {
      systemPromptExpanded: currentChatWindow.systemPromptExpanded,
      toggleSystemPromptExpanded: state.toggleSystemPromptExpanded,
      onChangeSystemPrompt: state.onChangeSystemPrompt,
      systemPrompt: currentChatWindow.systemPrompt,
      syncSystemPrompts: state.syncSystemPrompts,
      toggleSyncSystemPrompts: state.toggleSyncSystemPrompts,
    };
  });

  return (
    <VStack
      width="full"
      backgroundColor="gray.50"
      borderTop="1px solid"
      borderColor="gray.200"
      padding={3}
    >
      <HStack width="full" paddingLeft={8}>
        <Text textTransform="uppercase" fontSize="12px" color="gray.500">
          System Prompt
        </Text>
        <Spacer />
        {systemPromptExpanded && (
          <Checkbox
            size="sm"
            checked={syncSystemPrompts}
            onChange={(e) => {
              e.stopPropagation();
              toggleSyncSystemPrompts(systemPrompt);
            }}
          >
            <Text color="gray.400" fontSize="13px">
              Sync
            </Text>
          </Checkbox>
        )}
        <Button
          size="xs"
          color="gray.500"
          variant="ghost"
          padding="6px"
          onClick={() => toggleSystemPromptExpanded(windowId)}
        >
          <ChevronDown width="16px" height="16px" />
        </Button>
      </HStack>

      {systemPromptExpanded && (
        <Box paddingLeft={6} width="full">
          <Textarea
            fontSize="13px"
            placeholder="You are a helpful assistant..."
            onChange={(e) => onChangeSystemPrompt(windowId, e.target.value)}
            value={systemPrompt}
          />
        </Box>
      )}
    </VStack>
  );
}

function ChatInputBox({
  windowId,
  windowIndex,
  chatWindowState,
}: {
  windowId: string;
  windowIndex: number;
  chatWindowState: { input: string };
}) {
  const [isFocused, setIsFocused] = useDebounceValue(false, 200);
  const inputRef = useRef<HTMLInputElement>(null);
  const undoHistory = usePlaygroundStore.temporal.getState();

  const { syncInputs, toggleSyncInputs, onChangeInput, onSubmit } =
    usePlaygroundStore((state) => ({
      syncInputs: state.syncInputs,
      toggleSyncInputs: state.toggleSyncInputs,
      onChangeInput: state.onChangeInput,
      onSubmit: state.onSubmit,
    }));

  return (
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
        <InputGroup
          endElement={
            <HStack gap={2}>
              {isFocused && (
                <Checkbox
                  size="sm"
                  checked={syncInputs}
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
          }
        >
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
            fontSize="14px"
          />
        </InputGroup>
      </form>
    </Box>
  );
}
