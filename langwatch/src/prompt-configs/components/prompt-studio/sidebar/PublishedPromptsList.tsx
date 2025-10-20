import { Sidebar } from "./ui/Sidebar";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useMemo } from "react";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";

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
        >
          {prompt.name}
        </Sidebar.Item>
      ))}
    </Sidebar.List>
  );
}
