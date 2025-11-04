import { HStack, IconButton, Spacer } from "@chakra-ui/react";
import { PromptBrowserWindowContent } from "./prompt-browser-window/PromptBrowserWindowContent";
import { PromptBrowserTab } from "./tab/PromptBrowserTab";
import { useDraggableTabsBrowserStore } from "../../prompt-studio-store/DraggableTabsBrowserStore";
import { DraggableTabsBrowser } from "./ui/DraggableTabsBrowser";
import { Columns } from "react-feather";
import { TabIdProvider } from "./ui/TabContext";

/**
 * Tabbed workspace for the prompt studio with draggable tabs and split-pane support.
 * Single Responsibility: Manages the draggable tab interface for editing multiple prompts simultaneously.
 */
export function PromptStudioTabbedWorkspace() {
  const {
    windows,
    splitTab,
    moveTab,
    setActiveTab,
    activeWindowId,
    setActiveWindow,
  } = useDraggableTabsBrowserStore();

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
      {windows.map((tabbedWindow) => (
        <DraggableTabsBrowser.Group
          key={tabbedWindow.id}
          groupId={tabbedWindow.id}
          activeTabId={tabbedWindow.activeTabId ?? undefined}
          onTabChange={handleTabChange}
          onClick={() => setActiveWindow({ windowId: tabbedWindow.id })}
          borderRight="1px solid var(--chakra-colors-gray-350)"
          maxWidth={windows.length > 1 ? "50vw" : "auto"}
        >
          <DraggableTabsBrowser.TabBar
            tabIds={tabbedWindow.tabs.map((tab) => tab.id)}
          >
            <HStack gap={0} overflowX="auto">
              {tabbedWindow.tabs.map((tab) => (
                <TabIdProvider key={tab.id} tabId={tab.id}>
                  <DraggableTabsBrowser.Tab
                    id={tab.id}
                    borderRight="1px solid var(--chakra-colors-gray-350)"
                  >
                    <DraggableTabsBrowser.Trigger value={tab.id}>
                      <PromptBrowserTab
                        dimmed={tabbedWindow.id !== activeWindowId}
                      />
                    </DraggableTabsBrowser.Trigger>
                  </DraggableTabsBrowser.Tab>
                </TabIdProvider>
              ))}
            </HStack>
            <Spacer />
            {tabbedWindow.id === activeWindowId && (
              <HStack flexShrink={0} paddingX={3} title="Split tab">
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label="Split tab"
                  onClick={() => handleSplit(tabbedWindow.activeTabId)}
                >
                  <Columns size="18px" />
                </IconButton>
              </HStack>
            )}
          </DraggableTabsBrowser.TabBar>
          <HStack width="full" flex={1}>
            {tabbedWindow.tabs.map((tab) => (
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
