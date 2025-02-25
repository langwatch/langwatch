import {
  Box,
  Button,
  HStack,
  Spacer,
  Tabs,
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
      <Tabs.Root
        colorPalette="orange"
        width="full"
        height="calc(100vh - 115px)"
        backgroundColor="white"
        paddingTop={4}
        value={state.activeTabIndex.toString()}
        onValueChange={(change) => {
          const index = parseInt(change.value);
          if (index >= state.tabs.length) {
            state.addNewTab();
          } else {
            state.selectTab(index);
          }
        }}
      >
        <HStack width="full">
          <Box overflowX="auto" paddingBottom="9px" marginBottom="-9px">
            <Tabs.List>
              {state.tabs.map((tab, index) => (
                <Tabs.Trigger key={index} value={index.toString()}>
                  <HStack gap={3}>
                    <Box as="span" whiteSpace="nowrap">{tab.name}</Box>
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
                          css={{
                            "&:hover": { background: "var(--chakra-colors-gray-50)" }
                          }}
                        >
                          <X width="16px" />
                        </Box>
                      )}
                  </HStack>
                </Tabs.Trigger>
              ))}
              <Tabs.Trigger value={state.tabs.length.toString()}>
                <Plus width="16px" />
              </Tabs.Trigger>
              <Tabs.Indicator />
            </Tabs.List>
          </Box>
          <Spacer />
          <HStack gap={0} paddingRight={3}>
            <Button
              color="gray.500"
              size="xs"
              variant="ghost"
              onClick={() => undo()}
              disabled={pastStates.length === 0}
            >
              <RotateCcw width="16px" />
            </Button>
            <Button
              color="gray.500"
              size="xs"
              variant="ghost"
              onClick={() => redo()}
              disabled={futureStates.length === 0}
            >
              <RotateCw width="16px" />
            </Button>
          </HStack>
        </HStack>

        {state.tabs.map((tab, tabIndex) => (
          <Tabs.Content key={tabIndex} value={tabIndex.toString()}>
            <PlaygroundTab
              chatWindows={tab.chatWindows}
              tabIndex={tabIndex}
            />
          </Tabs.Content>
        ))}
      </Tabs.Root>
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
    <Box
      key={tabIndex}
      padding={0}
      height="full"
      minHeight={0}
      background="gray.100"
      outline="1px solid"
      outlineColor="gray.200"
    >
      <HStack gap={0} overflowX="auto" height="full" minHeight={0}>
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
    </Box>
  );
}
