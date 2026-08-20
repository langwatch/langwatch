import { HStack } from "@chakra-ui/react";
import { useRef } from "react";
import type { Tab } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { PromptTabSwitcher } from "./switcher/PromptTabSwitcher";
import { PromptBrowserTab } from "./tab/PromptBrowserTab";
import { DraggableTabsBrowser } from "./ui/DraggableTabsBrowser";
import { TabIdProvider } from "./ui/TabContext";
import { useIsOverflowing } from "./useIsOverflowing";

/**
 * Fades the trailing edge of the strip while tabs are scrolled out of view.
 *
 * A mask, not a painted gradient: it only varies the strip's own opacity, so it
 * cannot fall out of step with the colour behind it the way the previous
 * `bg.panel` gradient did on every surface that was not `bg.panel`. Three stops
 * rather than two, so the ramp reads as a fade instead of a band with an edge.
 * The colours here are alpha carriers — a mask ignores their hue.
 */
const STRIP_FADE_MASK =
  "linear-gradient(to right, #000 0, #000 calc(100% - 36px), rgba(0, 0, 0, 0.45) calc(100% - 14px), transparent 100%)";

interface PromptTabStripProps {
  tabs: Tab[];
  activeTabId?: string;
  /** Tabs in a pane the user is not working in render dimmed. */
  isActiveWindow: boolean;
  onSelectTab: (tabId: string) => void;
}

/**
 * PromptTabStrip
 *
 * Single Responsibility: Render one pane's scrolling row of prompt tabs,
 * alongside the switcher that reaches the tabs scrolled out of it.
 *
 * A component rather than inline JSX because each pane needs its own ref to
 * its own scroller, and a ref cannot be created inside the loop over panes.
 */
export function PromptTabStrip({
  tabs,
  activeTabId,
  isActiveWindow,
  onSelectTab,
}: PromptTabStripProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const isStripOverflowing = useIsOverflowing(scrollerRef, tabs.length);

  return (
    <>
      <HStack
        ref={scrollerRef}
        gap={0}
        overflow="auto"
        height="full"
        paddingY={1.5}
        paddingX={1.5}
        // Tabs shrink to share this row before it ever scrolls, so `flex` lets
        // the strip claim the width the toolbar is not using.
        flex="1 1 0"
        minWidth={0}
        css={
          isStripOverflowing
            ? { maskImage: STRIP_FADE_MASK, WebkitMaskImage: STRIP_FADE_MASK }
            : undefined
        }
      >
        {tabs.map((tab) => (
          <TabIdProvider key={tab.id} tabId={tab.id}>
            <DraggableTabsBrowser.Tab id={tab.id} height="full">
              <DraggableTabsBrowser.Trigger value={tab.id}>
                <PromptBrowserTab
                  dimmed={!isActiveWindow}
                  isActive={tab.id === activeTabId}
                  isCrowded={isStripOverflowing}
                />
              </DraggableTabsBrowser.Trigger>
            </DraggableTabsBrowser.Tab>
          </TabIdProvider>
        ))}
      </HStack>
      <PromptTabSwitcher
        tabIds={tabs.map((tab) => tab.id)}
        activeTabId={activeTabId}
        onSelect={onSelectTab}
        scrollerRef={scrollerRef}
        isStripOverflowing={isStripOverflowing}
      />
    </>
  );
}
