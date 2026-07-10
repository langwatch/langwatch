import { HStack } from "@chakra-ui/react";
import { useRef } from "react";
import type { Tab } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { PromptTabSwitcher } from "./switcher/PromptTabSwitcher";
import { PromptBrowserTab } from "./tab/PromptBrowserTab";
import { DraggableTabsBrowser } from "./ui/DraggableTabsBrowser";
import { TabIdProvider } from "./ui/TabContext";

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

  return (
    <>
      <HStack
        ref={scrollerRef}
        gap={0}
        overflow="auto"
        height="full"
        paddingY={2}
        paddingX={2}
      >
        {tabs.map((tab) => (
          <TabIdProvider key={tab.id} tabId={tab.id}>
            <DraggableTabsBrowser.Tab id={tab.id} height="full">
              <DraggableTabsBrowser.Trigger value={tab.id}>
                <PromptBrowserTab dimmed={!isActiveWindow} />
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
      />
    </>
  );
}
