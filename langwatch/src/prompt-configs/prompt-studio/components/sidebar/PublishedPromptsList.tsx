import { Sidebar } from "./ui/Sidebar";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useMemo } from "react";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";
import { useDraggableTabsBrowserStore } from "../../prompt-studio-store/DraggableTabsBrowserStore";
import { groupBy } from "lodash-es";
import { useAllPromptsForProject } from "~/prompt-configs/hooks/useAllPromptsForProject";

export function PublishedPromptsList() {
  const { data } = useAllPromptsForProject();
  const groupedPrompts = useMemo(() => {
    const publishedPrompts = data?.filter((prompt) => prompt.version > 0);
    console.log(publishedPrompts);
    return groupBy(publishedPrompts, (prompt) =>
      prompt.handle?.includes("/") ? prompt.handle?.split("/")[0] : "default",
    );
  }, [data]);

  const { addTab } = useDraggableTabsBrowserStore();

  console.log(groupedPrompts);
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
              onClick={() => addTab({ data: { promptId: prompt.id } })}
            >
              {prompt.handle ?? "Untitled"}
            </Sidebar.Item>
          ))}
        </Sidebar.List>
      ))}
    </>
  );
}
