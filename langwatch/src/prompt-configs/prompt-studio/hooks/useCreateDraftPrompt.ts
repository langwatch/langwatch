import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";
import { computeInitialFormValuesForPrompt } from "~/prompt-configs/utils/computeInitialFormValuesForPrompt";

/**
 * Hook to create a draft prompt in the database
 * and add it to the prompt browser
 */
export function useCreateDraftPrompt() {
  const { project } = useOrganizationTeamProject();
  const { addTab } = useDraggableTabsBrowserStore();

  const createDraftPrompt = useCallback(async () => {
    const projectDefaultModel = project?.defaultModel;
    const normalizedDefaultModel =
      typeof projectDefaultModel === "string" ? projectDefaultModel : undefined;

    const defaultValues = computeInitialFormValuesForPrompt({
      prompt: null,
      defaultModel: normalizedDefaultModel,
      useSystemMessage: true,
    });

    addTab({
      data: {
        form: { defaultValues, isDirty: false },
        meta: {
          title: defaultValues.handle ?? null,
          versionNumber: defaultValues.versionMetadata?.versionNumber,
        },
      },
    });

    return { prompt: undefined as any, defaultValues };
  }, [addTab, project?.defaultModel]);

  return { createDraftPrompt };
}
