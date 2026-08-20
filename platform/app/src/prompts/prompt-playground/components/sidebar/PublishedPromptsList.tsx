import { Skeleton } from "@chakra-ui/react";
import { groupBy } from "lodash-es";
import { useMemo } from "react";
import { ProviderIconGlyph } from "~/components/modelProviders/iconsMap";
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { promptContextChip } from "~/features/langy/logic/langyContextChips";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "~/prompts/hooks/useAllPromptsForProject";
import { computeInitialFormValuesForPrompt } from "~/prompts/utils/computeInitialFormValuesForPrompt";
import type { modelProviders } from "~/server/modelProviders/registry";
import { api } from "~/utils/api";
import { useDraggableTabsBrowserStore } from "../../prompt-playground-store/DraggableTabsBrowserStore";
import { activePromptId } from "./activePromptId";
import { PublishedPromptContent } from "./PublishedPromptContent";
import { Sidebar } from "./ui/Sidebar";
import { SidebarEmptyState } from "./ui/SidebarEmptyState";

/**
 * Displays a list of published prompts grouped by folder.
 * Single Responsibility: Renders published prompts organized by folder with click-to-open functionality.
 */
export function PublishedPromptsList() {
  const { data, isLoading } = useAllPromptsForProject();
  const { addTab } = useDraggableTabsBrowserStore(({ addTab }) => ({ addTab }));
  const { project } = useOrganizationTeamProject();

  // Which row the list marks as selected. The selector returns a string, so it
  // stays referentially stable across store writes that don't change it.
  const selectedPromptId = useDraggableTabsBrowserStore(activePromptId);

  // Cascade-resolved model for new-tab prompt defaults.
  const resolvedDefault = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "prompt.create_default" },
    { enabled: !!project?.id },
  );

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

  if (isLoading) {
    return (
      <Sidebar.List>
        {[1, 2, 3, 4].map((i) => (
          <Sidebar.Item key={i}>
            <Skeleton width="full" height="20px" borderRadius="sm" />
          </Sidebar.Item>
        ))}
      </Sidebar.List>
    );
  }

  if (publishedPrompts?.length === 0) {
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
            // While the Langy panel is open the prompt can be pointed at and
            // absorbed as context; its own click (open in a tab) is untouched.
            // Inert while Langy is closed.
            <LangyContextTarget
              key={prompt.id}
              target={promptContextChip({
                promptId: prompt.id,
                handle: prompt.handle,
              })}
            >
              <Sidebar.Item
                active={prompt.id === selectedPromptId}
                icon={
                  <ProviderIconGlyph
                    provider={
                      prompt.model?.split("/")[0] as keyof typeof modelProviders
                    }
                    size="16px"
                  />
                }
                onClick={() => {
                  const defaultValues = computeInitialFormValuesForPrompt({
                    prompt,
                    defaultModel: resolvedDefault.data?.model ?? "",
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
                      variableValues: {},
                    },
                  });
                }}
              >
                <PublishedPromptContent
                  promptId={prompt.id}
                  promptHandle={prompt.handle}
                  prompt={prompt}
                />
              </Sidebar.Item>
            </LangyContextTarget>
          ))}
        </Sidebar.List>
      ))}
    </>
  );
}
