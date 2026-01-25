import { useCallback } from "react";
import { getMaxTokenLimit } from "~/components/llmPromptConfigs/utils/tokenUtils";
import { useModelProvidersSettings } from "~/hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { buildDefaultFormValues } from "~/prompts/utils/buildDefaultFormValues";
import { DEFAULT_MODEL } from "~/utils/constants";
import { useDraggableTabsBrowserStore } from "../prompt-playground-store/DraggableTabsBrowserStore";

/**
 * Default system prompt for new prompts created in the playground.
 * This is different from the global default to provide onboarding guidance.
 */
const PLAYGROUND_DEFAULT_SYSTEM_PROMPT = `Welcome to the LangWatch Prompt Playground

Edit this template to get started

Add variables via double brackets like this: {{input}}

`;

/**
 * Hook to create a draft prompt in the database and add it to the prompt browser.
 * Single Responsibility: Creates a new draft prompt tab with default values.
 * @returns Object containing createDraftPrompt function
 */
export function useCreateDraftPrompt() {
  const { project } = useOrganizationTeamProject();
  const { modelMetadata } = useModelProvidersSettings({ projectId: project?.id });
  const { addTab } = useDraggableTabsBrowserStore(({ addTab }) => ({ addTab }));

  /**
   * createDraftPrompt
   * Single Responsibility: Creates a new draft prompt tab with default configuration values.
   * Uses buildDefaultFormValues for consistency across all contexts.
   * @returns Promise resolving to object with defaultValues
   */
  const createDraftPrompt = useCallback(async () => {
    const defaultModel = project?.defaultModel ?? DEFAULT_MODEL;
    const defaultModelMetadata = modelMetadata?.[defaultModel];
    const maxTokens = getMaxTokenLimit(defaultModelMetadata);

    // Use unified defaults with project model override if available
    // Override system message with playground-specific onboarding prompt
    const defaultValues = buildDefaultFormValues({
      version: {
        configData: {
          llm: {
            model: defaultModel,
            maxTokens,
          },
          // lodash merge merges arrays by index, so this updates the first message's content
          messages: [{ content: PLAYGROUND_DEFAULT_SYSTEM_PROMPT }],
        },
      },
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
          title: defaultValues.handle,
        },
        variableValues: {},
      },
    });

    // Focus the system prompt textarea after the tab is rendered
    setTimeout(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        'textarea[data-role="system"]',
      );
      textarea?.focus();
    }, 100);

    return { defaultValues };
  }, [addTab, modelMetadata, project?.defaultModel]);

  return { createDraftPrompt };
}
