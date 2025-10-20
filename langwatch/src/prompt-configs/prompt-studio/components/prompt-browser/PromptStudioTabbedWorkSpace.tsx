import { useMemo, useState } from "react";
import { Box } from "@chakra-ui/react";
import { BrowserLikeTabs } from "./ui/BrowserLikeTabs";
import { PromptBrowserWindow } from "./prompt-browser-window/PromptBrowserWindow";
import { PromptBrowserTab } from "./ui/PromptBrowserTab";
import { usePromptStudioStore } from "../../prompt-studio-store/store";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

interface PromptStudioTabbedWorkSpaceProps {
  workspaceId: string;
}

export function PromptStudioTabbedWorkSpace({
  workspaceId,
}: PromptStudioTabbedWorkSpaceProps) {
  const { projectId = "" } = useOrganizationTeamProject();
  const { removePrompt } = usePromptStudioStore();
  const workspace = usePromptStudioStore((state) =>
    state.getWorkspace(workspaceId),
  );

  function handleTabChange(tabId: string) {
    setActiveTabId(tabId);
  }

  function handleTabClose(tabId: string) {
    removePrompt({ configId: tabId, workspaceId });
  }

  // Don't do it this way
  const { data: prompts } = api.prompts.getAllPromptsForProject.useQuery(
    {
      projectId: projectId,
    },
    {
      enabled: !!projectId,
    },
  );

  const tabs = useMemo(() => {
    const configIds = workspace?.prompts.map((prompt) => prompt.configId);
    return prompts?.filter((prompt) => configIds?.includes(prompt.id));
  }, [workspace, prompts]);

  const [activeTabId, setActiveTabId] = useState<string | null>(
    tabs?.[0]?.id ?? null,
  );

  if (!tabs || tabs.length === 0) return null;
  if (activeTabId === null) return null;

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
