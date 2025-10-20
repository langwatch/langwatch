import { useState } from "react";
import { Box } from "@chakra-ui/react";
import { BrowserLikeTabs } from "./ui";
import { PromptBrowserTab } from "./ui/PromptBrowserTab";

// Placeholder components for now - these would be replaced with actual implementations
function PromptEditor() {
  return (
    <Box padding={4} height="full">
      <Box bg="gray.100" height="full" borderRadius="md" padding={4}>
        Prompt Editor Component - Coming Soon
      </Box>
    </Box>
  );
}

function PromptPreview() {
  return (
    <Box padding={4} height="full">
      <Box bg="gray.100" height="full" borderRadius="md" padding={4}>
        Prompt Preview Component - Coming Soon
      </Box>
    </Box>
  );
}

interface Tab {
  id: string;
  title: string;
  content: React.ReactNode;
  hasUnsavedChanges?: boolean;
}

export function PromptStudioTabbedWorkSpace() {
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: "prompt-editor",
      title: "Prompt Editor",
      content: <PromptEditor />,
    },
    {
      id: "prompt-preview",
      title: "Prompt Preview",
      content: <PromptPreview />,
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
      content: <PromptEditor />,
    };

    setTabs([...tabs, newTab]);
    setActiveTabId(newTabId);
  };

  return (
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
        <PromptEditor />
      </BrowserLikeTabs.Content>
      <BrowserLikeTabs.Content value="prompt-preview">
        <PromptPreview />
      </BrowserLikeTabs.Content>
    </BrowserLikeTabs.Root>
  );
}
