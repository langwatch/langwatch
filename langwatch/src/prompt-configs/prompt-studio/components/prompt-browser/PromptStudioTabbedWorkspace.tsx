import { HStack, Spacer } from "@chakra-ui/react";
import { PromptBrowserWindowContent } from "./prompt-browser-window/PromptBrowserWindowContent";
import { PromptBrowserTab } from "./tab/PromptBrowserTab";
import { useDraggableTabsBrowserStore } from "../../prompt-studio-store/DraggableTabsBrowserStore";
import { DraggableTabsBrowser } from "./ui/DraggableTabsBrowser";
import { SplitSquareHorizontal } from "lucide-react";
import { TabIdProvider } from "./ui/TabContext";
import { useLoadSpanIntoPromptStudio } from "../../hooks/useLoadSpanIntoPromptStudio";

export function PromptStudioTabbedWorkspace() {
  const {
    windows,
    removeTab,
    splitTab,
    moveTab,
    setActiveTab,
    activeWindowId,
    setActiveWindow,
  } = useDraggableTabsBrowserStore();
  useLoadSpanIntoPromptStudio();

  function handleTabMove(params: {
    tabId: string;
    from: { groupId: string; index: number };
    to: { groupId: string; index: number };
  }) {
    moveTab({
      tabId: params.tabId,
      windowId: params.to.groupId,
      index: params.to.index,
    });
  }

  function handleTabChange(groupId: string, tabId: string) {
    setActiveTab({ windowId: groupId, tabId });
  }

  function handleSplit(tabId: string) {
    splitTab({ tabId });
  }

  return (
    <DraggableTabsBrowser.Root onTabMove={handleTabMove}>
      {windows.map((window) => (
        <DraggableTabsBrowser.Group
          key={window.id}
          groupId={window.id}
          activeTabId={window.activeTabId ?? undefined}
          onTabChange={handleTabChange}
          onClick={() => setActiveWindow({ windowId: window.id })}
          borderRight="1px solid var(--chakra-colors-gray-350)"
          maxWidth={windows.length > 1 ? "50vw" : "auto"}
        >
          <DraggableTabsBrowser.TabBar>
            <HStack gap={0} overflowX="auto">
              {window.tabs.map((tab) => (
                <TabIdProvider key={tab.id} tabId={tab.id}>
                  <DraggableTabsBrowser.Tab
                    id={tab.id}
                    borderRight="1px solid var(--chakra-colors-gray-350)"
                  >
                    <DraggableTabsBrowser.Trigger value={tab.id}>
                      <PromptBrowserTab
                        onRemove={() => removeTab({ tabId: tab.id })}
                        dimmed={window.id !== activeWindowId}
                      />
                    </DraggableTabsBrowser.Trigger>
                  </DraggableTabsBrowser.Tab>
                </TabIdProvider>
              ))}
            </HStack>
            <Spacer />
            {window.id === activeWindowId && (
              <HStack flexShrink={0} paddingX={3}>
                <SplitSquareHorizontal
                  size="18px"
                  cursor="pointer"
                  onClick={() =>
                    window.activeTabId && handleSplit(window.activeTabId)
                  }
                />
              </HStack>
            )}
          </DraggableTabsBrowser.TabBar>
          <HStack width="full" flex={1}>
            {window.tabs.map((tab) => (
              <TabIdProvider key={tab.id} tabId={tab.id}>
                <DraggableTabsBrowser.Content value={tab.id} height="full">
                  <PromptBrowserWindowContent />
                </DraggableTabsBrowser.Content>
              </TabIdProvider>
            ))}
          </HStack>
        </DraggableTabsBrowser.Group>
      ))}
    </DraggableTabsBrowser.Root>
  );
}
