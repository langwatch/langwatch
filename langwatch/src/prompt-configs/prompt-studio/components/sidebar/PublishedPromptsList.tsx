import { Sidebar } from "./ui/Sidebar";
import { useMemo } from "react";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { useDraggableTabsBrowserStore } from "../../prompt-studio-store/DraggableTabsBrowserStore";
import { groupBy } from "lodash-es";
import { useAllPromptsForProject } from "~/prompt-configs/hooks/useAllPromptsForProject";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { computeInitialFormValuesForPrompt } from "~/prompt-configs/utils/computeInitialFormValuesForPrompt";
import { Text } from "@chakra-ui/react";

export function getDisplayHandle(handle?: string | null): string {
  if (!handle) return "Untitled";
  return handle?.includes("/") ? handle.split("/")[1]! : handle;
}

export function PublishedPromptsList() {
  const { data } = useAllPromptsForProject();
  const { addTab } = useDraggableTabsBrowserStore();
  const { project } = useOrganizationTeamProject();

  /**
   * Group the prompts by folder, derived from the handle prefix.
   */
  const groupedPrompts = useMemo(() => {
    const publishedPrompts = data?.filter((prompt) => prompt.version > 0);
    return groupBy(publishedPrompts, (prompt) =>
      prompt.handle?.includes("/") ? prompt.handle?.split("/")[0] : "default",
    );
  }, [data]);

  return (
    <>
      {Object.entries(groupedPrompts).map(([folder, prompts]) => (
        <Sidebar.List
          key={folder}
          title={folder === "default" ? undefined : folder}
          collapsible={folder !== "default"}
          defaultOpen={false}
        >
          {prompts.map((prompt) => (
            <Sidebar.Item
              key={prompt.id}
              icon={
                modelProviderIcons[
                  prompt.model.split("/")[0] as keyof typeof modelProviderIcons
                ]
              }
              onClick={() => {
                const projectDefaultModel = project?.defaultModel;
                const normalizedDefaultModel =
                  typeof projectDefaultModel === "string"
                    ? projectDefaultModel
                    : undefined;
                const defaultValues = computeInitialFormValuesForPrompt({
                  prompt,
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
                      versionNumber:
                        defaultValues.versionMetadata?.versionNumber,
                    },
                  },
                });
              }}
            >
              <Text
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
                fontSize="sm"
                fontWeight="normal"
              >
                {getDisplayHandle(prompt.handle)}
              </Text>
            </Sidebar.Item>
          ))}
        </Sidebar.List>
      ))}
    </>
  );
}
