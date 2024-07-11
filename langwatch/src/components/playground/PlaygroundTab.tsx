import {
  Box,
  Button,
  HStack,
  Spacer,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
} from "@chakra-ui/react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { Plus, RotateCcw, RotateCw, X } from "react-feather";
import { usePlaygroundStore } from "../../hooks/usePlaygroundStore";
import { ChatWindowWrapper } from "./ChatWindow";
import { useRouter } from "next/router";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import React from "react";
import { useLoadChatMessagesEffect } from "~/hooks/useLoadChatMessages";
import { useMemoizedChatWindowIds } from "~/hooks/useMemoizedChatWindowIds";

export function PlaygroundTabs() {
  const router = useRouter();

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
      setMessages: state.setMessages,
      onChangeSystemPrompt: state.onChangeSystemPrompt,
    };
  });
  const { undo, redo, pastStates, futureStates } =
    usePlaygroundStore.temporal.getState();

  const { project } = useOrganizationTeamProject();
  const { span, traceId } = router.query;
  // Memoized chat window IDs to prevent infinite loop in useLoadChatMessagesEffect
  const memoizedChatWindowIds = useMemoizedChatWindowIds({
    chatWindows: state.tabs[state.activeTabIndex]?.chatWindows,
  });
  // Load chat messages into all tabs.
  useLoadChatMessagesEffect({
    spanId: Array.isArray(span) ? span[0] : span ?? "",
    projectId: project?.id ?? "",
    traceId: Array.isArray(traceId) ? traceId[0] : traceId ?? "",
    chatWindowIds: memoizedChatWindowIds,
    onSetMessages: state.setMessages,
    onChangeSystemPrompt: state.onChangeSystemPrompt,
  });

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
                windowsCount={chatWindows.length}
              />
            ))}
          </SortableContext>
        </DndContext>
      </HStack>
    </TabPanel>
  );
}
