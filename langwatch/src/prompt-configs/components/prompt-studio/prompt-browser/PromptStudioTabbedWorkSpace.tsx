import { useState } from "react";
import { Box } from "@chakra-ui/react";
import { BrowserLikeTabs } from "./ui";
import { PromptBrowserTab } from "./ui/PromptBrowserTab";
import { PromptBrowserWindow } from "./prompt-browser-window/PromptBrowserWindow";

interface Tab {
  id: string;
  title: string;
  hasUnsavedChanges?: boolean;
}

export function PromptStudioTabbedWorkSpace() {
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: "prompt-editor",
      title: "Prompt Editor",
    },
    {
      id: "prompt-preview",
      title: "Prompt Preview",
    },
  ]);

  const [activeTabId, setActiveTabId] = useState("prompt-editor");

  const handleTabChange = (tabId: string) => {
    setActiveTabId(tabId);
  };

  const handleTabClose = (tabId: string) => {
    if (tabs.length > 1) {
      const newTabs = tabs.filter((tab) => tab.id !== tabId);
      setTabs(newTabs);

      // If closing the active tab, select the first remaining tab
      if (tabId === activeTabId) {
        setActiveTabId(newTabs[0]?.id ?? "");
      }
    }
  };

  const handleAddTab = () => {
    const newTabId = `tab-${Date.now()}`;
    const newTab: Tab = {
      id: newTabId,
      title: `New Tab ${tabs.length + 1}`,
    };

    setTabs([...tabs, newTab]);
    setActiveTabId(newTabId);
  };

  return (
    <Box minW="400px" height="full">
      <BrowserLikeTabs.Root
        tabs={tabs}
        activeTabId={activeTabId}
        onTabChange={handleTabChange}
        onTabClose={handleTabClose}
        onAddTab={handleAddTab}
      >
        <PromptBrowserTab
          value="prompt-editor"
          version={1}
          title="Prompt Editor"
          hasUnsavedChanges={true}
        />
        <PromptBrowserTab
          value="prompt-preview"
          version={1}
          title="Prompt Preview"
        />
        <BrowserLikeTabs.Content value="prompt-editor">
          <PromptBrowserWindow configId="prompt_TbiIk6DRso_RfA2CpP6g3" />
        </BrowserLikeTabs.Content>
        <BrowserLikeTabs.Content value="prompt-preview">
          <PromptBrowserWindow />
        </BrowserLikeTabs.Content>
      </BrowserLikeTabs.Root>
    </Box>
  );
}
