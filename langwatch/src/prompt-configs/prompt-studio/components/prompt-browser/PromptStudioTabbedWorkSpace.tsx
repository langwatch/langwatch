import { useEffect, useMemo, useState } from "react";
import { Box, Spacer } from "@chakra-ui/react";
import { BrowserLikeTabs } from "./ui/BrowserLikeTabs";
import { PromptBrowserWindow } from "./prompt-browser-window/PromptBrowserWindow";
import { PromptBrowserTab } from "./ui/PromptBrowserTab";
import { usePromptStudioStore } from "../../prompt-studio-store/store";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "~/prompt-configs/hooks/useAllPromptsForProject";
import { DraggableTabsBrowser } from "./ui/DraggableTabsBrowser";
import { SplitSquareVertical } from "lucide-react";

export function PromptStudioTabbedWorkSpace() {
  const promptsInWorkspaces = usePromptStudioStore(
    (s) => s.promptsInWorkspaces,
  );
  const promptIdsByWorkspaceIndex = useMemo(() => {
    return promptsInWorkspaces.reduce(
      (acc, prompt) => {
        acc[prompt.workspaceIndex] = [
          ...(acc[prompt.workspaceIndex] ?? []),
          prompt.id,
        ];
        return acc;
      },
      {} as Record<number, string[]>,
    );
  }, [promptsInWorkspaces]);
  const removePrompt = usePromptStudioStore((s) => s.removePrompt);
  const splitPrompt = usePromptStudioStore((s) => s.splitPrompt);

  function handleTabMove(
    fromGroupId: string,
    toGroupId: string,
    tabId: string,
    destinationIndex: number,
  ) {
    console.log(
      "handleTabMove",
      fromGroupId,
      toGroupId,
      tabId,
      destinationIndex,
    );
  }

  function handleClose(tabId: string) {
    console.log("handleClose", tabId);
    removePrompt({ id: tabId });
  }

  console.log(promptsInWorkspaces, promptIdsByWorkspaceIndex);

  return (
    <DraggableTabsBrowser.Root onTabMove={handleTabMove}>
      {Object.entries(promptIdsByWorkspaceIndex).map(
        ([workspaceIndex, promptIds]) => (
          <DraggableTabsBrowser.Group
            key={workspaceIndex}
            groupId={workspaceIndex}
            activeTabId={promptIds[0]}
          >
            <DraggableTabsBrowser.TabBar>
              {promptIds.map((promptId) => (
                <DraggableTabsBrowser.Trigger key={promptId} value={promptId}>
                  <PromptBrowserTab
                    title={promptId}
                    version={1}
                    onClose={() => handleClose(promptId)}
                  />
                </DraggableTabsBrowser.Trigger>
              ))}
              <Spacer />
              <SplitSquareVertical
                onClick={() =>
                  promptIds[0] && splitPrompt({ id: promptIds[0] })
                }
              />
            </DraggableTabsBrowser.TabBar>
            {promptIds.map((promptId) => (
              <DraggableTabsBrowser.Content key={promptId} value={promptId}>
                <PromptBrowserWindow configId={promptId} />
              </DraggableTabsBrowser.Content>
            ))}
          </DraggableTabsBrowser.Group>
        ),
      )}
    </DraggableTabsBrowser.Root>
  );
}
