import { groupBy } from "lodash-es";
import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import { computeInitialFormValuesForPrompt } from "~/prompts/utils/computeInitialFormValuesForPrompt";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { PublishedPromptContent } from "./PublishedPromptContent";
import { Sidebar } from "./ui/Sidebar";
import { SidebarEmptyState } from "./ui/SidebarEmptyState";

/**
 * Returns a display-friendly version of a prompt handle.
 * Single Responsibility: Formats prompt handles for UI display by extracting folder-relative names or returning "Untitled".
 * @param handle - The prompt handle (may include folder prefix separated by "/")
 * @returns The display name (portion after "/" or full handle, or "Untitled" if empty)
 */
export function getDisplayHandle(handle?: string | null): string {
  if (!handle) return "Untitled";
  return handle?.includes("/") ? handle.split("/")[1]! : handle;
}

/**
 * Displays a list of published prompts grouped by folder.
 * Single Responsibility: Renders published prompts organized by folder with click-to-open functionality.
 */
export function PublishedPromptsList() {
  const { data } = useAllPromptsForProject();
  const { addTab } = useDraggableTabsBrowserStore(({ addTab }) => ({ addTab }));
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
                      initialMessagesFromSpanData: [],
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
              paddingY={1}
              paddingLeft={2}
            >
              <PublishedPromptContent
                promptId={prompt.id}
                promptHandle={prompt.handle}
                prompt={prompt}
              />
            </Sidebar.Item>
          ))}
        </Sidebar.List>
      ))}
    </>
  );
}
