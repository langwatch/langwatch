import { Spacer } from "@chakra-ui/react";
import { PromptBrowserWindowContent } from "./prompt-browser-window/PromptBrowserWindowContent";
import { PromptBrowserTab } from "./ui/PromptBrowserTab";
import { useDraggableTabsBrowserStore } from "../../prompt-studio-store/DraggableTabsBrowserStore";
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

  function handleClose(tabId: string) {
    removeTab({ tabId });
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
        >
          <DraggableTabsBrowser.TabBar>
            {window.tabs.map((tab) => (
              <DraggableTabsBrowser.Trigger key={tab.id} value={tab.id}>
                <DraggableTabsBrowser.Tab>
                  <PromptBrowserTab
                    hasUnsavedChanges={tab.data.form.isDirty}
                    title={tab.data.meta.title ?? "Untitled"}
                    version={tab.data.meta.versionNumber}
                    onClose={() => handleClose(tab.id)}
                  />
                </DraggableTabsBrowser.Tab>
              </DraggableTabsBrowser.Trigger>
            ))}
            <Spacer />
            {window.id === activeWindowId && (
              <SplitSquareHorizontal
                size="18px"
                cursor="pointer"
                onClick={() =>
                  window.activeTabId && handleSplit(window.activeTabId)
                }
              />
            )}
          </DraggableTabsBrowser.TabBar>
          {window.tabs.map((tab) => (
            <DraggableTabsBrowser.Content key={tab.id} value={tab.id}>
              <PromptBrowserWindowContent
                configId={tab.data.form.defaultValues.configId}
                tabId={tab.id}
              />
            </DraggableTabsBrowser.Content>
          ))}
        </DraggableTabsBrowser.Group>
      ))}
    </DraggableTabsBrowser.Root>
  );
}
