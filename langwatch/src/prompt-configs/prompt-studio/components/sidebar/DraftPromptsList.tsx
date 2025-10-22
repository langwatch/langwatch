import { Sidebar } from "./ui/Sidebar";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useMemo } from "react";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { Text } from "@chakra-ui/react";
import { useDraggableTabsBrowserStore } from "../../prompt-studio-store/DraggableTabsBrowserStore";
import { computeInitialFormValuesForPrompt } from "~/prompt-configs/utils/computeInitialFormValuesForPrompt";

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

  const { addTab } = useDraggableTabsBrowserStore();

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
          onClick={() => {
            const projectDefaultModel = project?.defaultModel;
            const normalizedDefaultModel =
              typeof projectDefaultModel === "string"
                ? projectDefaultModel
                : undefined;
            const defaultValues = computeInitialFormValuesForPrompt({
              prompt: draft,
              defaultModel: normalizedDefaultModel,
              useSystemMessage: true,
            });
            addTab({
              data: {
                form: {
                  defaultValues,
                  isDirty: false,
                },
                meta: {
                  title: defaultValues.handle ?? null,
                  versionNumber: defaultValues.versionMetadata?.versionNumber,
                },
              },
            });
          }}
        >
          <Text
            fontStyle={!draft.handle ? "italic" : "normal"}
            opacity={!draft.handle ? 0.8 : 1}
            fontSize="sm"
            fontWeight="normal"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            width="full"
          >
            {draft.handle ?? "Untitled"}
          </Text>
        </Sidebar.Item>
      ))}
    </Sidebar.List>
  );
}
