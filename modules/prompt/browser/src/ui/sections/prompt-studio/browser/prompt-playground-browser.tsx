import { HStack, IconButton, useBreakpointValue } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { LuColumns2 } from "react-icons/lu";

import { useDraggableTabsBrowserStore } from "../../../../features/tabs/behavior/use-prompt-tabs-browser-store.ts";
import { AddPromptButton } from "../sidebar/add-prompt-button.tsx";
import { TabIdProvider } from "../studio-internals.ts";
import { DraggableTabsBrowser } from "./draggable-tabs-browser.tsx";
import { ExperimentFromPlaygroundButton } from "./experiment-from-playground-button.tsx";
import { PromptTabStrip } from "./prompt-tab-strip.tsx";
import { PromptBrowserWindowContent } from "./window/prompt-browser-window-content.tsx";

/** The narrowest a pane gets beside another one: room for its tab row and toolbar. */
const PANE_MIN_WIDTH = "360px";

/** Tabbed browser for the prompt playground, with draggable tabs and split-pane support. */
export function PromptPlaygroundBrowser() {
  const isCompact = useBreakpointValue({ base: true, md: false }, { fallback: "md" }) === true;
  const windows = useDraggableTabsBrowserStore((state) => state.windows);
  const splitTab = useDraggableTabsBrowserStore((state) => state.splitTab);
  const moveTab = useDraggableTabsBrowserStore((state) => state.moveTab);
  const setActiveTab = useDraggableTabsBrowserStore((state) => state.setActiveTab);
  const activeWindowId = useDraggableTabsBrowserStore((state) => state.activeWindowId);
  const setActiveWindow = useDraggableTabsBrowserStore((state) => state.setActiveWindow);

  // Panes share the room the studio gives them; a pane never narrows below its floor, and the
  // area scrolls sideways inside the studio when the floors no longer fit. With the sidebar in a
  // drawer each pane takes the screen.
  let paneMinWidth: string | undefined;
  if (windows.length > 1) paneMinWidth = isCompact ? "calc(100vw - 16px)" : PANE_MIN_WIDTH;

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

  function handleTabChange({ windowId, tabId }: { windowId: string; tabId: string }) {
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
          minPaneWidth={paneMinWidth}
          paddingTop={0}
        >
          <DraggableTabsBrowser.TabBar
            tabIds={tabbedWindow.tabs.map((tab) => tab.id)}
            height="48px"
            flexShrink={0}
            paddingRight={2}
          >
            {/* The switcher lives inside the strip, not in the toolbar below,
                because the toolbar only renders for the active pane - and a
                pane you are not working in still has tabs worth reaching. */}
            <PromptTabStrip
              tabs={tabbedWindow.tabs}
              activeTabId={tabbedWindow.activeTabId ?? undefined}
              isActiveWindow={tabbedWindow.id === activeWindowId}
              onSelectTab={(tabId) => handleTabChange({ windowId: tabbedWindow.id, tabId })}
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
                  <ExperimentFromPlaygroundButton />
                  <Tooltip content="Compare">
                    <IconButton
                      aria-label="Compare"
                      onClick={() =>
                        tabbedWindow.activeTabId && handleSplit(tabbedWindow.activeTabId)
                      }
                      size="sm"
                      variant="outline"
                      disabled={!tabbedWindow.activeTabId}
                      title="Split tab to compare prompts side by side"
                    >
                      <LuColumns2 size="16px" />
                    </IconButton>
                  </Tooltip>
                  <AddPromptButton iconOnly />
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
