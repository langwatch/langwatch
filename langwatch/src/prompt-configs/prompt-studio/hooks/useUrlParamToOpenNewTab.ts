import { useEffect } from "react";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { computeInitialFormValuesForPrompt } from "~/prompt-configs/utils/computeInitialFormValuesForPrompt";
import { usePromptIdQueryParam } from "~/hooks/usePromptIdQueryParam";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";

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
  const { addTab } = useDraggableTabsBrowserStore();
  const { selectedPromptId } = usePromptIdQueryParam();
  const trpc = api.useContext();

  useEffect(() => {
    async function openNewTab() {
      if (!selectedPromptId) return;

      const prompt = await trpc.prompts.getByIdOrHandle.fetch({
        idOrHandle: selectedPromptId,
        projectId: project?.id ?? "",
      });

      if (!prompt) return;

      const projectDefaultModel = project?.defaultModel;
      const normalizedDefaultModel =
        typeof projectDefaultModel === "string"
          ? projectDefaultModel
          : undefined;

      const defaultValues = computeInitialFormValuesForPrompt({
        prompt: prompt,
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
            versionNumber: defaultValues.versionMetadata?.versionNumber,
            scope: defaultValues.scope,
          },
        },
      });
    }

    void openNewTab().catch((error) =>
      logger.error({ error }, "Error opening new tab"),
    );
  }, [
    addTab,
    project?.defaultModel,
    project?.id,
    selectedPromptId,
    trpc.prompts.getByIdOrHandle,
  ]);
}
