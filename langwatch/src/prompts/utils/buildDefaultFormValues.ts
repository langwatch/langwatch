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
        // GPT-5 models require temperature 1, so we use 1 as the default
        // since DEFAULT_MODEL is openai/gpt-5
        temperature: 1,
        maxTokens: 1000,
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
