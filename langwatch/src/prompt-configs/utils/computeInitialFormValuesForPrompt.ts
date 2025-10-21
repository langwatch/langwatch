import type { PromptConfigFormValues } from "~/prompt-configs/types";
import { buildDefaultFormValues } from "~/prompt-configs/utils/buildDefaultFormValues";
import {
  versionedPromptToPromptConfigFormValues,
  versionedPromptToPromptConfigFormValuesWithSystemMessage,
} from "~/prompt-configs/utils/llmPromptConfigUtils";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";

/**
 * computeInitialFormValuesForPrompt
 * Single Responsibility: Produce initial form values from either a prompt, a default model, or defaults.
 */
export function computeInitialFormValuesForPrompt(params: {
  prompt?: VersionedPrompt | null;
  defaultModel?: string;
  useSystemMessage?: boolean;
}): PromptConfigFormValues {
  const { prompt, defaultModel, useSystemMessage } = params;

  if (prompt) {
    return useSystemMessage
      ? versionedPromptToPromptConfigFormValuesWithSystemMessage(prompt)
      : versionedPromptToPromptConfigFormValues(prompt);
  }

  if (typeof defaultModel === "string" && defaultModel.length > 0) {
    return buildDefaultFormValues({
      version: { configData: { llm: { model: defaultModel } } },
    });
  }

  return buildDefaultFormValues({});
}
