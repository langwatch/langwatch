import { HStack, Spacer } from "@chakra-ui/react";
import { LuColumns2 } from "react-icons/lu";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { AddPromptButton } from "../sidebar/AddPromptButton";
import { ExperimentFromPlaygroundButton } from "./ExperimentFromPlaygroundButton";
import { PromptBrowserWindowContent } from "./prompt-browser-window/PromptBrowserWindowContent";
import { PromptBrowserTab } from "./tab/PromptBrowserTab";
import { DraggableTabsBrowser } from "./ui/DraggableTabsBrowser";
import { TabIdProvider } from "./ui/TabContext";

/**
 * Tabbed browser for the prompt playground with draggable tabs and split-pane support.
 * Single Responsibility: Manages the browser-like tab interface for editing multiple prompts simultaneously.
 */
export function PromptPlaygroundBrowser() {
  const {
    windows,
    splitTab,
    moveTab,
    setActiveTab,
    activeWindowId,
    setActiveWindow,
  } = useDraggableTabsBrowserStore(
    ({
      windows,
      splitTab,
      moveTab,
      setActiveTab,
      activeWindowId,
      setActiveWindow,
    }) => ({
      windows,
      splitTab,
      moveTab,
      setActiveTab,
      activeWindowId,
      setActiveWindow,
    }),
  );

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
          maxWidth={
            windows.length > 1
              ? `calc((100vw - 340px) / ${windows.length})`
              : "auto"
          }
          paddingTop={0}
        >
          <DraggableTabsBrowser.TabBar
            tabIds={tabbedWindow.tabs.map((tab) => tab.id)}
          >
            <HStack
              gap={0}
              overflow="auto"
              height="full"
              paddingY={2}
              paddingX={2}
            >
              {tabbedWindow.tabs.map((tab) => (
                <TabIdProvider key={tab.id} tabId={tab.id}>
                  <DraggableTabsBrowser.Tab id={tab.id} height="full">
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
              <>
                <HStack
                  flexShrink={0}
                  paddingLeft={1}
                  position="relative"
                  _before={{
                    content: '""',
                    position: "absolute",
                    left: "-10px",
                    top: 0,
                    bottom: 0,
                    width: "10px",
                    height: "50px",
                    background:
                      "linear-gradient(to right, transparent, var(--chakra-colors-bg-panel))",
                    zIndex: 10,
                    pointerEvents: "none",
                  }}
                >
                  <ExperimentFromPlaygroundButton />
                  <PageLayout.HeaderButton
                    onClick={() =>
                      tabbedWindow.activeTabId &&
                      handleSplit(tabbedWindow.activeTabId)
                    }
                    disabled={!tabbedWindow.activeTabId}
                    title="Split tab to compare prompts side by side"
                  >
                    <LuColumns2 size="18px" />
                    Compare
                  </PageLayout.HeaderButton>
                  <AddPromptButton />
                </HStack>
              </>
            )}
          </DraggableTabsBrowser.TabBar>
          {tabbedWindow.tabs.map((tab) => (
            <TabIdProvider key={tab.id} tabId={tab.id}>
              <DraggableTabsBrowser.Content
                value={tab.id}
                height="full"
                borderRadius="lg"
                boxShadow="md"
                background="bg.panel"
                padding={0}
                minHeight="0"
              >
                <PromptBrowserWindowContent />
              </DraggableTabsBrowser.Content>
            </TabIdProvider>
          ))}
        </DraggableTabsBrowser.Group>
      ))}
    </DraggableTabsBrowser.Root>
  );
}
