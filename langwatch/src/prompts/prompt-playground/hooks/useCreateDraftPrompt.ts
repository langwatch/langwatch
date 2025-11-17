import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";
import type { PromptConfigFormValues } from "~/prompts/types";
import { DEFAULT_MODEL, DEFAULT_MAX_TOKENS } from "~/utils/constants";

/**
 * Hook to create a draft prompt in the database and add it to the prompt browser.
 * Single Responsibility: Creates a new draft prompt tab with default values.
 * @returns Object containing createDraftPrompt function
 */
export function useCreateDraftPrompt() {
  const { project } = useOrganizationTeamProject();
  const { addTab } = useDraggableTabsBrowserStore();

  /**
   * createDraftPrompt
   * Single Responsibility: Creates a new draft prompt tab with default configuration values.
   * @returns Promise resolving to object with defaultValues
   */
  const createDraftPrompt = useCallback(async () => {
    const projectDefaultModel = project?.defaultModel;
    const normalizedDefaultModel =
      typeof projectDefaultModel === "string"
        ? projectDefaultModel
        : DEFAULT_MODEL;

    const defaultValues: PromptConfigFormValues = {
      handle: null,
      scope: "PROJECT",
      version: {
        configData: {
          prompt: "You are a helpful assistant.",
          llm: {
            model: normalizedDefaultModel,
            maxTokens: DEFAULT_MAX_TOKENS,
            temperature: 1,
          },
          inputs: [],
          outputs: [{ identifier: "output", type: "str" }],
          messages: [
            { role: "system", content: "You are a helpful assistant." },
          ],
        },
      },
    };

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
      },
    });

    return { defaultValues };
  }, [addTab, project?.defaultModel]);

  return { createDraftPrompt };
}
