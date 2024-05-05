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
import { useChat } from "ai/react";
import { Select as MultiSelect, chakraComponents } from "chakra-react-select";
import isDeepEqual from "fast-deep-equal";
import { useEffect, useRef } from "react";
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
  type ChatWindowState,
  type PlaygroundTabState,
} from "../../hooks/usePlaygroundStore";
import { useRequiredSession } from "../../hooks/useRequiredSession";

export default function Playground() {
  const state = usePlaygroundStore((state) => state);
  const { undo, redo, pastStates, futureStates } =
    usePlaygroundStore.temporal.getState();

  return (
    <DashboardLayout>
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
                        <Button
                          size="xs"
                          variant="ghost"
                          padding={1}
                          onClick={() => state.closeTab(index)}
                          color={
                            index === state.activeTabIndex
                              ? "orange.400"
                              : "gray.500"
                          }
                        >
                          <X width="16px" />
                        </Button>
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
            <PlaygroundTab key={tabIndex} tab={tab} tabIndex={tabIndex} />
          ))}
        </TabPanels>
      </Tabs>
    </DashboardLayout>
  );
}

function PlaygroundTab({
  tab,
  tabIndex,
}: {
  tab: PlaygroundTabState;
  tabIndex: number;
}) {
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
        {tab.chatWindows.map((chatWindow, windowIndex) => (
          <ChatWindow
            key={windowIndex}
            chatWindow={chatWindow}
            tabIndex={tabIndex}
            windowIndex={windowIndex}
          />
        ))}
      </HStack>
    </TabPanel>
  );
}

function ChatWindow({
  chatWindow,
  tabIndex,
  windowIndex,
}: {
  chatWindow: ChatWindowState;
  tabIndex: number;
  windowIndex: number;
}) {
  const { data: session } = useRequiredSession();

  const {
    addChatWindow,
    removeChatWindow,
    setModel,
    tabs,
    syncInputs,
    toggleSyncInputs,
    onChangeInput,
    onSubmit,
    setMessages,
  } = usePlaygroundStore((state) => state);
  const chatWindowState = tabs[tabIndex]?.chatWindows[windowIndex];
  const [isFocused, setIsFocused] = useDebounceValue(false, 200);
  const inputRef = useRef<HTMLInputElement>(null);
  const undoHistory = usePlaygroundStore.temporal.getState();

  const {
    messages: localMessages,
    setMessages: setLocalMessages,
    handleInputChange,
    handleSubmit,
  } = useChat({
    api: "/api/playground",
    headers: {
      "X-Model": chatWindowState?.model.value ?? "",
    },
  });

  useEffect(() => {
    if (!chatWindowState) return;

    const simulatedEvent = {
      target: { value: chatWindowState.input },
    } as React.ChangeEvent<HTMLInputElement>;

    handleInputChange(simulatedEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatWindowState?.input, handleInputChange]);

  useEffect(() => {
    if (!chatWindowState) return;

    if (chatWindowState.requestedSubmission) {
      const simulatedSubmissionEvent = {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        preventDefault: () => {},
      } as React.FormEvent<HTMLFormElement>;
      handleSubmit(simulatedSubmissionEvent);
      onSubmit(windowIndex, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatWindowState?.requestedSubmission, handleSubmit]);

  useEffect(() => {
    if (!chatWindowState) return;

    undoHistory.pause();
    if (!isDeepEqual(chatWindowState.messages, localMessages)) {
      setMessages(windowIndex, localMessages);
    }
    undoHistory.resume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localMessages]);

  useEffect(() => {
    if (!chatWindowState) return;

    if (!isDeepEqual(chatWindowState.messages, localMessages)) {
      setLocalMessages(chatWindowState.messages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatWindowState?.messages]);

  if (!chatWindowState) {
    return null;
  }

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
    >
      <HStack
        width="100%"
        backgroundColor="gray.50"
        outline="1px solid"
        outlineColor="gray.200"
        padding={2}
      >
        <DragHandleIcon width="14px" height="14px" color="gray.350" />
        <MultiSelect
          className="fix-hidden-inputs"
          value={chatWindowState.model}
          onChange={(value) => value && setModel(windowIndex, value)}
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
            dropdownIndicator: (provided, state) => ({
              ...provided,
              background: "white",
              padding: 0,
              paddingRight: 2,
              width: "auto",
              border: "none",
            }),
            indicatorSeparator: (provided, state) => ({
              ...provided,
              display: "none",
            }),
          }}
          components={{
            Option: ({ children, ...props }) => (
              <chakraComponents.Option {...props}>
                <HStack spacing={2} align="center">
                  <Box width="14px">{props.data.icon}</Box>
                  <Text fontSize={12} fontFamily="mono">
                    {children}
                  </Text>
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
                    <Text fontSize={12} fontFamily="mono">
                      {children}
                    </Text>
                    <Text fontSize={12} fontFamily="mono" color="gray.400">
                      ({version})
                    </Text>
                  </HStack>
                </chakraComponents.ValueContainer>
              );
            },
          }}
        />
        <Spacer />
        <HStack spacing={0}>
          <Button
            size="xs"
            color="gray.500"
            variant="ghost"
            padding="6px"
            onClick={() => removeChatWindow(windowIndex)}
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
        <VStack
          width="full"
          height="full"
          overflowY="auto"
          align="start"
          spacing={0}
          borderTop="1px solid"
          borderColor="gray.200"
        >
          {chatWindowState.messages.map((message, index) => (
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
                  {chatWindowState.model.icon}
                </Box>
              )}
              <Text paddingTop="2px" whiteSpace="pre-wrap">
                {message.content}
              </Text>
            </HStack>
          ))}
        </VStack>

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

              onSubmit(windowIndex, true);
            }}
          >
            <InputGroup>
              <Input
                autoFocus={windowIndex === 0}
                value={chatWindowState.input}
                onChange={(e) => {
                  undoHistory.pause();
                  onChangeInput(windowIndex, e.target.value);
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
}
