import { useEffect } from "react";
import { usePromptProject } from "./use-prompt-project";
import { usePromptIdQueryParam } from "./use-prompt-id-query-param";
import { computeInitialFormValuesForPrompt } from "../model/prompt-form";
import { promptApi } from "./prompt-api";
import { useDraggableTabsBrowserStore } from "./use-prompt-tabs-browser-store";

/**
 * Custom hook to open a new tab based on a promptId in the URL.
 * Single Responsibility: Opens a new tab based on a promptId in the URL.
 *
 * Note: we don't check for the prompt if it's already open in a tab,
 * since multiple tabs can be open for the same prompt.
 */
export function useUrlParamToOpenNewTab() {
  const { project } = usePromptProject();
  const { addTab } = useDraggableTabsBrowserStore(({ addTab }) => ({ addTab }));
  const { selectedPromptId } = usePromptIdQueryParam();
  const trpc = promptApi.useUtils();

  // Cascade-resolved model for new prompts. The query subscribes lazily
  // so the effect can read the cached value without firing a second
  // request when the URL changes.
  const resolvedDefault = promptApi.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "prompt.create_default" },
    { enabled: !!project?.id },
  );
  const resolvedDefaultModel = resolvedDefault.data?.model;

  useEffect(() => {
    /**
     * openNewTab
     * Single Responsibility: Fetches prompt data and creates a new tab with the prompt configuration.
     */
    async function openNewTab() {
      if (!selectedPromptId) return;
      if (!project?.id) return;

      const prompt = await trpc.prompts.getByIdOrHandle.fetch({
        idOrHandle: selectedPromptId,
        projectId: project.id,
      });

      if (!prompt) return;

      const defaultValues = computeInitialFormValuesForPrompt({
        prompt: prompt,
        defaultModel: resolvedDefaultModel,
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
            scope: defaultValues.scope,
          },
          variableValues: {},
        },
      });
    }

    // A failure here is a prompt that will not open; the reader sees the tab
    // never arrive, which is the same thing the application's log line said.
    void openNewTab().catch(() => undefined);
  }, [addTab, resolvedDefaultModel, project?.id, selectedPromptId, trpc.prompts.getByIdOrHandle]);
}
