import { Sidebar } from "./ui/Sidebar";
import { useMemo } from "react";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { useDraggableTabsBrowserStore } from "../../prompt-studio-store/DraggableTabsBrowserStore";
import { groupBy } from "lodash-es";
import { useAllPromptsForProject } from "~/prompt-configs/hooks/useAllPromptsForProject";

export function PublishedPromptsList() {
  const { data } = useAllPromptsForProject();
  const { addTab } = useDraggableTabsBrowserStore();

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
              onClick={() =>
                addTab({
                  data: {
                    prompt,
                  },
                })
              }
            >
              {prompt.handle ?? "Untitled"}
            </Sidebar.Item>
          ))}
        </Sidebar.List>
      ))}
    </>
  );
}
