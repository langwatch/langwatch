import {
  buildDefaultFormValues,
  type PromptConfigFormValues,
} from "@langwatch/prompt-web/surfaces/prompt-form";
import {
  versionedPromptToPromptConfigFormValues,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "~/prompts/utils/llmPromptConfigUtils";
import type { VersionedPrompt } from "@langwatch/prompt-contract";

/**
 * computeInitialFormValuesForPrompt
 * Single Responsibility: Produce initial form values from either a prompt, a default model, or defaults.
 * TODO: This seems redundant with the other methods. Let's consider a refactor
 */
export function computeInitialFormValuesForPrompt(params: {
  prompt?: VersionedPrompt | null;
  defaultModel?: string;
  maxTokens?: number;
  useSystemMessage?: boolean;
}): PromptConfigFormValues {
  const { prompt, defaultModel, maxTokens, useSystemMessage } = params;

  if (prompt) {
    return useSystemMessage
      ? versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt)
      : versionedPromptToPromptConfigFormValues(prompt);
  }

  if (typeof defaultModel === "string" && defaultModel.length > 0) {
    return buildDefaultFormValues({
      version: { configData: { llm: { model: defaultModel, maxTokens } } },
    });
  }

  return buildDefaultFormValues({});
}
