import { HStack, Spacer } from "@chakra-ui/react";
import { PromptBrowserWindowContent } from "./prompt-browser-window/PromptBrowserWindowContent";
import { PromptBrowserTab } from "./ui/PromptBrowserTab";
import {
  useDraggableTabsBrowserStore,
  type Tab,
} from "../../prompt-studio-store/DraggableTabsBrowserStore";
import { DraggableTabsBrowser } from "./ui/DraggableTabsBrowser";
import { SplitSquareHorizontal } from "lucide-react";

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

  // TODO: This isn't really working for the index/sorting within the same group
  // The start/over index is being calculated as -1, so nothing happens
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

  function handleClose(tab: Tab) {
    if (
      Boolean(tab?.data.form.isDirty) ||
      !Boolean(tab?.data.form.defaultValues.configId)
    ) {
      if (!confirm("Your unsaved changes will be lost. Proceed anyway?")) {
        return;
      }
    }

    removeTab({ tabId: tab.id });
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
                <DraggableTabsBrowser.Tab
                  key={tab.id}
                  id={tab.id}
                  borderRight="1px solid var(--chakra-colors-gray-350)"
                >
                  <DraggableTabsBrowser.Trigger value={tab.id}>
                    <PromptBrowserTab
                      hasUnsavedChanges={
                        tab.data.form.isDirty ||
                        !Boolean(tab.data.form.defaultValues.configId)
                      }
                      tabTitle={tab.data.meta.title ?? "Untitled"}
                      version={tab.data.meta.versionNumber}
                      onClose={() => handleClose(tab)}
                      dimmed={window.id !== activeWindowId}
                      scope={tab.data.meta.scope}
                    />
                  </DraggableTabsBrowser.Trigger>
                </DraggableTabsBrowser.Tab>
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
              <DraggableTabsBrowser.Content
                key={tab.id}
                value={tab.id}
                height="full"
              >
                <PromptBrowserWindowContent
                  configId={tab.data.form.defaultValues.configId}
                  tabId={tab.id}
                />
              </DraggableTabsBrowser.Content>
            ))}
          </HStack>
        </DraggableTabsBrowser.Group>
      ))}
    </DraggableTabsBrowser.Root>
  );
}
