import { useCallback } from "react";

import { getMaxTokenLimit } from "../model/max-token-limit.ts";
import { buildDefaultFormValues } from "../model/prompt-form/index.ts";
import { promptApi } from "./prompt-api.ts";
import { useModelProvidersSettings } from "./use-model-providers-settings.ts";
import { usePromptDefaultModel } from "./use-prompt-default-model.ts";
import { usePromptProject } from "./use-prompt-project.ts";
import { useDraggableTabsBrowserStore } from "./use-prompt-tabs-browser-store.ts";

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
  const { project } = usePromptProject();
  const { modelMetadata } = useModelProvidersSettings({
    projectId: project?.id,
  });
  const addTab = useDraggableTabsBrowserStore((state) => state.addTab);
  const utils = promptApi.useUtils();

  // Cascade-resolved model for "new prompt" surfaces. Returns null when
  // nothing is configured at any scope; the form then starts with no model.
  const resolvedDefault = usePromptDefaultModel();
  const projectId = project?.id;

  // A click can land before the query above answers, so a missing answer is
  // fetched here rather than read as "nothing configured": an empty model
  // would otherwise be replaced by the platform fallback when the form
  // parses it, silently ignoring the configured default.
  const readDefaultModel = useCallback(async (): Promise<string> => {
    if (resolvedDefault.data) return resolvedDefault.data.model;
    if (!projectId) return "";
    try {
      const fetched = await utils.modelProvider.getResolvedDefault.fetch({
        projectId,
        featureKey: "prompt.create_default",
      });
      return fetched?.model ?? "";
    } catch {
      return "";
    }
  }, [projectId, resolvedDefault.data, utils.modelProvider.getResolvedDefault]);

  /**
   * createDraftPrompt Single Responsibility: Creates a new draft prompt tab with default
   * configuration values. Uses buildDefaultFormValues for consistency across all contexts.
   * @returns Promise resolving to object with defaultValues
   */
  const createDraftPrompt = useCallback(async () => {
    const defaultModel = await readDefaultModel();
    const defaultModelMetadata = defaultModel ? modelMetadata?.[defaultModel] : undefined;
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
      const textarea = document.querySelector<HTMLTextAreaElement>('textarea[data-role="system"]');
      textarea?.focus();
    }, 100);

    return { defaultValues };
  }, [addTab, modelMetadata, readDefaultModel]);

  return { createDraftPrompt };
}
