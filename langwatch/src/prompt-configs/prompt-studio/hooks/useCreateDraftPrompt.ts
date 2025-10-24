import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDraggableTabsBrowserStore } from "../prompt-studio-store/DraggableTabsBrowserStore";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import { DEFAULT_MODEL } from "~/utils/constants";

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
        form: {
          currentValues: defaultValues,
        },
        meta: {
          title: defaultValues.handle,
        },
      },
    });

    return { prompt: undefined as any, defaultValues };
  }, [addTab, project?.defaultModel]);

  return { createDraftPrompt };
}
