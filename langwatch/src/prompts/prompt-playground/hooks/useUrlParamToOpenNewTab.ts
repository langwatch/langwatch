import { useEffect } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePromptIdQueryParam } from "~/hooks/usePromptIdQueryParam";
import { computeInitialFormValuesForPrompt } from "~/prompts/utils/computeInitialFormValuesForPrompt";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";
import { useDraggableTabsBrowserStore } from "../prompt-playground-store/DraggableTabsBrowserStore";

const logger = createLogger("useUrlParamToOpenNewTab");

/**
 * Custom hook to open a new tab based on a promptId in the URL.
 * Single Responsibility: Opens a new tab based on a promptId in the URL.
 *
 * Note: we don't check for the prompt if it's already open in a tab,
 * since multiple tabs can be open for the same prompt.
 */
export function useUrlParamToOpenNewTab() {
  const { project } = useOrganizationTeamProject();
  const { addTab } = useDraggableTabsBrowserStore(({ addTab }) => ({ addTab }));
  const { selectedPromptId } = usePromptIdQueryParam();
  const trpc = api.useContext();

  // Cascade-resolved model for new prompts. The query subscribes lazily
  // so the effect can read the cached value without firing a second
  // request when the URL changes.
  const resolvedDefault = api.modelProvider.getResolvedDefault.useQuery(
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

    void openNewTab().catch((error) =>
      logger.error({ error }, "Error opening new tab"),
    );
  }, [
    addTab,
    resolvedDefaultModel,
    project?.id,
    selectedPromptId,
    trpc.prompts.getByIdOrHandle,
  ]);
}
