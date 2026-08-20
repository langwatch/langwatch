import { Box, HStack, IconButton } from "@chakra-ui/react";
import { LuColumns2 } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { AddPromptButton } from "../sidebar/AddPromptButton";
import { ExperimentFromPlaygroundButton } from "./ExperimentFromPlaygroundButton";
import { PromptTabStrip } from "./PromptTabStrip";
import { PromptBrowserWindowContent } from "./prompt-browser-window/PromptBrowserWindowContent";
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
            {/* Strip chrome, not a toolbar: these are secondary to the tabs
                they sit beside, so they run at the strip's own button scale
                rather than the editor toolbar's. Opening another prompt is the
                strip's own gesture and gets the browser's "+" next to the last
                tab; splitting the pane and starting an experiment act on what
                is open, so they sit past a hairline, and only the one that
                leaves the playground keeps a word on it.

                Every pane carries the same set. Showing them on the active pane
                only made two panes that are otherwise identical disagree about
                what they can do, and left the user hunting for the controls
                after clicking into the other one. Pointer-down claims the pane
                before the button's own click runs, so "+" opens the prompt in
                the strip the user actually reached for. */}
            <HStack
              flexShrink={0}
              gap={1}
              paddingRight={3}
              // The strip stretches its children so a tab can reach the card
              // below; this row is not a tab, so it centres itself in the row
              // rather than growing into the card's top edge.
              alignSelf="center"
              onPointerDownCapture={() =>
                setActiveWindow({ windowId: tabbedWindow.id })
              }
            >
              <AddPromptButton iconOnly size="xs" variant="ghost" />
              <Box
                width="1px"
                height="16px"
                background="border.muted"
                marginX={0.5}
              />
              <Tooltip content="Compare prompts side by side">
                <IconButton
                  aria-label="Compare prompts side by side"
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    tabbedWindow.activeTabId &&
                    handleSplit(tabbedWindow.activeTabId)
                  }
                  disabled={!tabbedWindow.activeTabId}
                >
                  <LuColumns2 size={14} />
                </IconButton>
              </Tooltip>
              <ExperimentFromPlaygroundButton
                iconOnly={windows.length > 1}
                size="xs"
                variant="outline"
              />
            </HStack>
          </DraggableTabsBrowser.TabBar>
          {/* The card. The strip above stands on the page ground and only the
              active tab joins this frame, so the content claims the room inside
              it and nothing else. */}
          <DraggableTabsBrowser.Panel>
            {tabbedWindow.tabs.map((tab) => (
              <TabIdProvider key={tab.id} tabId={tab.id}>
                <DraggableTabsBrowser.Content
                  value={tab.id}
                  height="full"
                  padding={0}
                  minHeight="0"
                  overflow="hidden"
                >
                  <PromptBrowserWindowContent />
                </DraggableTabsBrowser.Content>
              </TabIdProvider>
            ))}
          </DraggableTabsBrowser.Panel>
        </DraggableTabsBrowser.Window>
      ))}
    </DraggableTabsBrowser.Root>
  );
}
