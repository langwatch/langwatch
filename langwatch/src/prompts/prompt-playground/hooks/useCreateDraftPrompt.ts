import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { buildDefaultFormValues } from "~/prompts/utils/buildDefaultFormValues";
import { useDraggableTabsBrowserStore } from "../prompt-playground-store/DraggableTabsBrowserStore";

/**
 * Hook to create a draft prompt in the database and add it to the prompt browser.
 * Single Responsibility: Creates a new draft prompt tab with default values.
 * @returns Object containing createDraftPrompt function
 */
export function useCreateDraftPrompt() {
  const { project } = useOrganizationTeamProject();
  const { addTab } = useDraggableTabsBrowserStore(({ addTab }) => ({ addTab }));

  /**
   * createDraftPrompt
   * Single Responsibility: Creates a new draft prompt tab with default configuration values.
   * Uses buildDefaultFormValues for consistency across all contexts.
   * @returns Promise resolving to object with defaultValues
   */
  const createDraftPrompt = useCallback(async () => {
    const projectDefaultModel = project?.defaultModel;

    // Use unified defaults with project model override if available
    const defaultValues = buildDefaultFormValues(
      typeof projectDefaultModel === "string"
        ? { version: { configData: { llm: { model: projectDefaultModel } } } }
        : undefined
    );

    addTab({
      data: {
        chat: {
          initialMessagesFromSpanData: [],
        },
        form: {
          currentValues: defaultValues,
        },
        meta: {
          title: defaultValues.handle,
        },
        variableValues: {},
      },
    });

    return { defaultValues };
  }, [addTab, project?.defaultModel]);

  return { createDraftPrompt };
}
