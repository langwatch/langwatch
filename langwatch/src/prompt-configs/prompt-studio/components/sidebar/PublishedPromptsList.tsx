import { Sidebar } from "./ui/Sidebar";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useMemo } from "react";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { usePromptStudioStore } from "../../prompt-studio-store/store";

export function PublishedPromptsList() {
  const { project } = useOrganizationTeamProject();
  const { data } = api.prompts.getAllPromptsForProject.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    },
  );

  const prompts = useMemo(() => {
    return data?.filter((prompt) => prompt.version > 0);
  }, [data]);

  const addPrompt = usePromptStudioStore((s) => s.addPrompt);
  const active = usePromptStudioStore((s) => s.activeWorkspaceIndex);
  const setActive = usePromptStudioStore((s) => s.setActiveWorkspaceIndex);

  function ensureTargetIndex(): number {
    if (active == null) {
      // Start at 0 for the first workspace
      setActive(0);
      return 0;
    }
    return active;
  }

  return (
    <Sidebar.List>
      {prompts?.map((prompt) => (
        <Sidebar.Item
          key={prompt.id}
          icon={
            modelProviderIcons[
              prompt.model.split("/")[0] as keyof typeof modelProviderIcons
            ]
          }
          onClick={() => addPrompt({ id: prompt.id, workspaceIndex: ensureTargetIndex() })}
        >
          {prompt.name}
        </Sidebar.Item>
      ))}
    </Sidebar.List>
  );
}
