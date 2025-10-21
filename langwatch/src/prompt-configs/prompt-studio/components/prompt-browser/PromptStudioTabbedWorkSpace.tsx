import { useEffect, useMemo, useState } from "react";
import { Box } from "@chakra-ui/react";
import { BrowserLikeTabs } from "./ui/BrowserLikeTabs";
import { PromptBrowserWindow } from "./prompt-browser-window/PromptBrowserWindow";
import { PromptBrowserTab } from "./ui/PromptBrowserTab";
import { usePromptStudioStore } from "../../prompt-studio-store/store";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "~/prompt-configs/hooks/useAllPromptsForProject";

interface PromptStudioTabbedWorkSpaceProps {
  workspaceIndex: number;
}

export function PromptStudioTabbedWorkSpace({
  workspaceIndex,
}: PromptStudioTabbedWorkSpaceProps) {
  const { data: prompts } = useAllPromptsForProject();
  const removePrompt = usePromptStudioStore((s) => s.removePrompt);
  const getPromptIdsForWorkspaceIndex = usePromptStudioStore(
    (s) => s.getPromptIdsForWorkspaceIndex,
  );
  const setActiveWorkspaceIndex = usePromptStudioStore(
    (s) => s.setActiveWorkspaceIndex,
  );

  function handleTabChange(tabId: string) {
    setActiveWorkspaceIndex(workspaceIndex);
    setActiveTabId(tabId);
  }

  function handleTabClose(tabId: string) {
    setActiveWorkspaceIndex(workspaceIndex);
    removePrompt({ id: tabId });
  }

  const promptIdsForWorkspace = getPromptIdsForWorkspaceIndex({
    workspaceIndex,
  });

  const tabs = useMemo(() => {
    return prompts?.filter(
      (prompt) => promptIdsForWorkspace?.includes(prompt.id),
    );
  }, [prompts, promptIdsForWorkspace]);

  const [activeTabId, setActiveTabId] = useState<string | null>(
    tabs?.[0]?.id ?? null,
  );

  if (!tabs || tabs.length === 0) return null;
  if (activeTabId === null) return null;

  return (
    <Box
      minW="400px"
      height="full"
      width="full"
      onPointerDown={() => setActiveWorkspaceIndex(workspaceIndex)}
    >
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
                  title={tab.handle}
                  version={tab.version}
                  hasUnsavedChanges={tab.version === 0}
                  onClose={() => handleTabClose(tab.id)}
                />
              </BrowserLikeTabs.Trigger>
            ))}
          </BrowserLikeTabs.List>
        </BrowserLikeTabs.Bar>

        {tabs.map((tab) => (
          <BrowserLikeTabs.Content key={tab.id} value={tab.id}>
            <PromptBrowserWindow configId={tab.id} />
          </BrowserLikeTabs.Content>
        ))}
      </BrowserLikeTabs.Root>
    </Box>
  );
}
