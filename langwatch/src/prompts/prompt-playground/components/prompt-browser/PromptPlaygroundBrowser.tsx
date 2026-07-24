import { HStack } from "@chakra-ui/react";
import { LuColumns2 } from "react-icons/lu";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Tooltip } from "~/components/ui/tooltip";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { AddPromptButton } from "../sidebar/AddPromptButton";
import { ExperimentFromPlaygroundButton } from "./ExperimentFromPlaygroundButton";
import { PromptBrowserWindowContent } from "./prompt-browser-window/PromptBrowserWindowContent";
import { PromptTabStrip } from "./PromptTabStrip";
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

  function handleTabMove(params: {
    tabId: string;
    from: { windowId: string; index: number };
    to: { windowId: string; index: number };
  }) {
    moveTab({
      tabId: params.tabId,
      windowId: params.to.windowId,
      index: params.to.index,
    });
  }

  function handleTabChange({
    windowId,
    tabId,
  }: {
    windowId: string;
    tabId: string;
  }) {
    setActiveTab({ windowId, tabId });
  }

  function handleSplit(tabId: string) {
    splitTab({ tabId });
  }

  return (
    <DraggableTabsBrowser.Root onTabMove={handleTabMove}>
      {windows.map((tabbedWindow) => (
        <DraggableTabsBrowser.Window
          key={tabbedWindow.id}
          windowId={tabbedWindow.id}
          activeTabId={tabbedWindow.activeTabId ?? undefined}
          onTabChange={handleTabChange}
          onWindowClick={() => setActiveWindow({ windowId: tabbedWindow.id })}
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
            {/* The switcher lives inside the strip, not in the toolbar below,
                because the toolbar only renders for the active pane — and a
                pane you are not working in still has tabs worth reaching. */}
            <PromptTabStrip
              tabs={tabbedWindow.tabs}
              activeTabId={tabbedWindow.activeTabId ?? undefined}
              isActiveWindow={tabbedWindow.id === activeWindowId}
              onSelectTab={(tabId) =>
                handleTabChange({ windowId: tabbedWindow.id, tabId })
              }
            />
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
                  <ExperimentFromPlaygroundButton
                    iconOnly={windows.length > 1}
                  />
                  <Tooltip content="Compare" disabled={windows.length <= 1}>
                    <PageLayout.HeaderButton
                      onClick={() =>
                        tabbedWindow.activeTabId &&
                        handleSplit(tabbedWindow.activeTabId)
                      }
                      disabled={!tabbedWindow.activeTabId}
                      title="Split tab to compare prompts side by side"
                    >
                      <LuColumns2 size="18px" />
                      {windows.length <= 1 && "Compare"}
                    </PageLayout.HeaderButton>
                  </Tooltip>
                  <AddPromptButton iconOnly={windows.length > 1} />
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
        </DraggableTabsBrowser.Window>
      ))}
    </DraggableTabsBrowser.Root>
  );
}
