import { useState } from "react";
import { Box } from "@chakra-ui/react";
import { BrowserLikeTabs } from "./ui/BrowserLikeTabs";
import { PromptBrowserWindow } from "./prompt-browser-window/PromptBrowserWindow";
import { PromptBrowserTab } from "./ui/PromptBrowserTab";

interface Tab {
  id: string;
  title: string;
  hasUnsavedChanges?: boolean;
  configId?: string;
  version?: number;
}

export function PromptStudioTabbedWorkSpace() {
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: "prompt-editor",
      title: "Prompt Editor",
      hasUnsavedChanges: true,
      configId: "prompt_TbiIk6DRso_RfA2CpP6g3",
    },
    {
      id: "prompt-preview",
      title: "Prompt Preview",
      version: 1,
    },
  ]);

  const [activeTabId, setActiveTabId] = useState("prompt-editor");

  function handleTabChange(tabId: string) {
    setActiveTabId(tabId);
  }

  function handleTabClose(tabId: string) {
    const next = tabs.filter((t) => t.id !== tabId);
    setTabs(next);
    if (next.length > 0 && tabId === activeTabId) {
      setActiveTabId(next[0]?.id ?? "");
    }
  }

  if (tabs.length === 0) {
    return null;
  }

  return (
    <Box minW="400px" height="full" width="full">
      <BrowserLikeTabs.Root
        value={activeTabId}
        onValueChange={handleTabChange}
        colorPalette="orange"
      >
        <BrowserLikeTabs.Bar>
          <BrowserLikeTabs.List>
            {tabs.map((tab) => (
              <BrowserLikeTabs.Trigger key={tab.id} value={tab.id}>
                <PromptBrowserTab
                  title={tab.title}
                  version={tab.version}
                  hasUnsavedChanges={tab.hasUnsavedChanges}
                  onClose={() => handleTabClose(tab.id)}
                />
              </BrowserLikeTabs.Trigger>
            ))}
          </BrowserLikeTabs.List>
        </BrowserLikeTabs.Bar>

        {tabs.map((tab) => (
          <BrowserLikeTabs.Content key={tab.id} value={tab.id}>
            <PromptBrowserWindow configId={tab.configId} />
          </BrowserLikeTabs.Content>
        ))}
      </BrowserLikeTabs.Root>
    </Box>
  );
}
