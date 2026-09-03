import { Skeleton } from "@chakra-ui/react";
import { groupBy } from "lodash-es";
import { useMemo } from "react";
import { modelProviderIcons } from "../model-selection/model-provider-icons";
import { usePromptProject } from "../../../behavior/use-prompt-project";
import { useAllPromptsForProject } from "../../../behavior/use-all-prompts-for-project";
import { computeInitialFormValuesForPrompt } from "../../../surfaces/prompt-form";
import { promptApi } from "../../../behavior/prompt-api";
import { useDraggableTabsBrowserStore } from "../../../behavior/use-prompt-tabs-browser-store";
import { PublishedPromptContent } from "./published-prompt-content";
import { Sidebar, SidebarEmptyState } from "../studio-internals";

/**
 * Displays a list of published prompts grouped by folder.
 * Single Responsibility: Renders published prompts organized by folder with click-to-open functionality.
 */
export function PublishedPromptsList() {
  const { data, isLoading } = useAllPromptsForProject();
  const { addTab } = useDraggableTabsBrowserStore(({ addTab }) => ({ addTab }));
  const { project } = usePromptProject();

  // Cascade-resolved model for new-tab prompt defaults.
  const resolvedDefault = promptApi.modelProvider.getResolvedDefault.useQuery(
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
          <Sidebar.Item key={i} paddingY={1.5} paddingX={2.5}>
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
            // THE LANGY CONTEXT CHIP DID NOT TRAVEL. Each row used to be wrapped
            // in `LangyContextTarget` so an open Langy panel could absorb the
            // prompt as context; `@langwatch/langy-web` is ungoverned and
            // `apps/ui` may not import it. The same loss the me, automations,
            // agents, datasets and model-config families took.
            <Sidebar.Item
              key={prompt.id}
              icon={
                modelProviderIcons[prompt.model?.split("/")[0] as keyof typeof modelProviderIcons]
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
                      versionNumber: defaultValues.versionMetadata?.versionNumber,
                    },
                    variableValues: {},
                  },
                });
              }}
              paddingY={1.5}
              paddingX={2.5}
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
