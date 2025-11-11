import { HStack, IconButton, Spacer } from "@chakra-ui/react";
import { PromptBrowserWindowContent } from "./prompt-browser-window/PromptBrowserWindowContent";
import { PromptBrowserTab } from "./tab/PromptBrowserTab";
import { useDraggableTabsBrowserStore } from "../../prompt-studio-store/DraggableTabsBrowserStore";
import { DraggableTabsBrowser } from "./ui/DraggableTabsBrowser";
import { LuColumns2 } from "react-icons/lu";
import { TabIdProvider } from "./ui/TabContext";

/**
 * Tabbed browser for the prompt studio with draggable tabs and split-pane support.
 * Single Responsibility: Manages the browser-like tab interface for editing multiple prompts simultaneously.
 */
export function PromptStudioBrowser() {
  const {
    windows,
    splitTab,
    moveTab,
    setActiveTab,
    activeWindowId,
    setActiveWindow,
  } = useDraggableTabsBrowserStore();

  /**
   * handleTabMove
   * Single Responsibility: Moves a tab to a new position/window when dragged.
   */
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

  /**
   * handleTabChange
   * Single Responsibility: Sets the active tab within a window group.
   */
  function handleTabChange(groupId: string, tabId: string) {
    setActiveTab({ windowId: groupId, tabId });
  }

  /**
   * handleSplit
   * Single Responsibility: Splits the current tab into a new window pane.
   */
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
            <HStack gap={0} overflow="hidden" height="full">
              {tabbedWindow.tabs.map((tab) => (
                <TabIdProvider key={tab.id} tabId={tab.id}>
                  <DraggableTabsBrowser.Tab
                    id={tab.id}
                    borderRight="1px solid var(--chakra-colors-gray-350)"
                    height="full"
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
                  onClick={() =>
                    tabbedWindow.activeTabId &&
                    handleSplit(tabbedWindow.activeTabId)
                  }
                  disabled={!tabbedWindow.activeTabId}
                >
                  <LuColumns2 size="18px" />
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
