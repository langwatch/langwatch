import { Sidebar } from "./ui/Sidebar";
import { useMemo } from "react";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { useDraggableTabsBrowserStore } from "../../prompt-studio-store/DraggableTabsBrowserStore";
import { groupBy } from "lodash-es";
import { useAllPromptsForProject } from "~/prompt-configs/hooks/useAllPromptsForProject";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { computeInitialFormValuesForPrompt } from "~/prompt-configs/utils/computeInitialFormValuesForPrompt";
import { PublishedPromptContent } from "./PublishedPromptContent";
import { SidebarEmptyState } from "./ui/SidebarEmptyState";

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
    const grouped = groupBy(publishedPrompts, (prompt) =>
      prompt.handle?.includes("/") ? prompt.handle?.split("/")[0] : "default",
    );
    // Put the default folder last
    const sorted = Object.entries(grouped).sort((a, b) => {
      if (a[0] === "default") return 1;
      if (b[0] === "default") return -1;
      return 0;
    });

    return sorted;
  }, [data]);

  const publishedPrompts = data?.filter((prompt) => prompt.version > 0);

  if (!publishedPrompts || publishedPrompts.length === 0) {
    return <SidebarEmptyState />;
  }

  return (
    <>
      {groupedPrompts.map(([folder, prompts]) => (
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
                  prompt.model?.split("/")[0] as keyof typeof modelProviderIcons
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
                    chat: {
                      initialMessages: [],
                    },
                    form: {
                      currentValues: defaultValues,
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
              <PublishedPromptContent
                promptId={prompt.id}
                promptHandle={prompt.handle}
              />
            </Sidebar.Item>
          ))}
        </Sidebar.List>
      ))}
    </>
  );
}
