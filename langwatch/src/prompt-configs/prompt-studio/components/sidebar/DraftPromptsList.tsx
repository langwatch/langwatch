import { Sidebar } from "./ui/Sidebar";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useMemo } from "react";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { Text } from "@chakra-ui/react";

export function DraftPromptsList() {
  const { project } = useOrganizationTeamProject();
  const { data } = api.prompts.getAllPromptsForProject.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    },
  );

  const drafts = useMemo(() => {
    return data?.filter((prompt) => prompt.version === 0);
  }, [data]);

  return (
    <Sidebar.List title="Drafts" collapsible defaultOpen={false}>
      {drafts?.map((draft) => (
        <Sidebar.Item
          key={draft.id}
          icon={
            modelProviderIcons[
              draft.model.split("/")[0] as keyof typeof modelProviderIcons
            ]
          }
        >
          <Text
            fontStyle={!draft.handle ? "italic" : "normal"}
            opacity={!draft.handle ? 0.8 : 1}
          >
            {draft.handle ?? "Untitled"}
          </Text>
        </Sidebar.Item>
      ))}
    </Sidebar.List>
  );
}
