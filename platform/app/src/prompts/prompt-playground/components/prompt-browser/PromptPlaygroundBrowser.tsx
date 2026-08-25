import { HStack, IconButton } from "@chakra-ui/react";
import { LuColumns2, LuX } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { getDisplayHandle } from "~/prompts/utils/promptHandle";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { ExperimentFromPlaygroundButton } from "./ExperimentFromPlaygroundButton";
import { PromptTabStrip } from "./PromptTabStrip";
import { PromptBrowserWindowContent } from "./prompt-browser-window/PromptBrowserWindowContent";
import { usePromptBrowserTabController } from "./tab/usePromptBrowserTabController";
import {
  CARD_BORDER_COLOR,
  CARD_BORDER_WIDTH,
  CARD_RADIUS,
  TAB_STRIP_TOP_PADDING,
} from "./ui/cardSurface";
import { DraggableTabsBrowser } from "./ui/DraggableTabsBrowser";
import { TabIdProvider } from "./ui/TabContext";

function SingleTabCloseButton() {
  const { title, handleClose } = usePromptBrowserTabController();
  const name = getDisplayHandle(title);

  return (
    <Tooltip content={`Close ${name}`}>
      <IconButton
        aria-label={`Close ${name}`}
        size="xs"
        variant="ghost"
        onClick={handleClose}
      >
        <LuX size={14} />
      </IconButton>
    </Tooltip>
  );
}

/**
 * Tabbed browser for the prompt playground with draggable tabs and split-pane support.
 * Single Responsibility: Manages the browser-like tab interface for editing multiple prompts simultaneously.
 */
/**
 * The strip chrome's layout. A lone tab lets the chrome join the card below
 * it, so the row borrows the card's own surface, border and top-right corner
 * and stretches to meet it; with several tabs the row is just a row and
 * centres itself instead.
 */
function stripChromeLayout(isSingleTab: boolean) {
  return {
    flexShrink: 0,
    gap: 1,
    borderColor: CARD_BORDER_COLOR,
    paddingRight: isSingleTab ? 2 : 3,
    marginRight: isSingleTab ? 3 : 0,
    marginTop: isSingleTab ? TAB_STRIP_TOP_PADDING : 0,
    background: isSingleTab ? "bg.panel" : "transparent",
    borderTopWidth: isSingleTab ? CARD_BORDER_WIDTH : 0,
    borderRightWidth: isSingleTab ? CARD_BORDER_WIDTH : 0,
    borderTopRightRadius: isSingleTab ? CARD_RADIUS : 0,
    alignSelf: isSingleTab ? "stretch" : "center",
  } as const;
}

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
              shouldJoinTrailingActions={tabbedWindow.tabs.length === 1}
            />
            {/* Strip chrome, not a toolbar: these are secondary to the tabs
                they sit beside, so they run at the strip's own button scale
                rather than the editor toolbar's. Both act on what is already
                open, and only the one that leaves the playground keeps a word
                on it. Adding a prompt is not among them: that action belongs to
                the rail that lists the prompts, which is where it lives.

                Every pane carries the same set. Showing them on the active pane
                only made two panes that are otherwise identical disagree about
                what they can do, and left the user hunting for the controls
                after clicking into the other one. Pointer-down claims the pane
                before the button's own click runs, so a button acts on the
                strip the user actually reached for. */}
            <HStack
              {...stripChromeLayout(tabbedWindow.tabs.length === 1)}
              onPointerDownCapture={() =>
                setActiveWindow({ windowId: tabbedWindow.id })
              }
            >
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
              {tabbedWindow.tabs.length === 1 && tabbedWindow.activeTabId && (
                <TabIdProvider tabId={tabbedWindow.activeTabId}>
                  <SingleTabCloseButton />
                </TabIdProvider>
              )}
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
