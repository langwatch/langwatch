import { PromptScope } from "@prisma/client";
import { merge } from "lodash-es";

import { DEFAULT_MODEL } from "~/utils/constants";
import type { DeepPartial } from "~/utils/types";

import type { PromptConfigFormValues } from "../types";

/**
 * Single source of truth for default prompt configuration.
 * Used by Playground, Evaluations V3, and Optimization Studio.
 */
export const DEFAULT_FORM_VALUES: PromptConfigFormValues = {
  handle: null,
  scope: PromptScope.PROJECT,
  version: {
    configData: {
      llm: {
        model: DEFAULT_MODEL,
        // Temperature is omitted - not all models support it (e.g., reasoning models)
        // The UI will apply model-appropriate defaults based on supportedParameters
        temperature: undefined,
        // Sensible default for most models - the UI will adjust based on model's maxCompletionTokens
        maxTokens: 4096,
      },
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "{{input}}" },
      ],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
  },
};

/**
 * Builds the default form values with overrides.
 * Useful since a default model comes from the project settings
 * which should then be passed in as an override if applicable.
 * @param overrides - Overrides to the default form values
 * @returns The default form values with overrides
 */
export const buildDefaultFormValues = (
  overrides?: DeepPartial<PromptConfigFormValues>,
): PromptConfigFormValues => {
  // Pass empty object first so merge doesn't mutate the frozen DEFAULT_FORM_VALUES
  return merge({}, DEFAULT_FORM_VALUES, overrides ?? {});
};
