import { PromptScope } from "@prisma/client";
import { merge } from "lodash-es";

import { DEFAULT_MODEL } from "~/utils/constants";
import type { DeepPartial } from "~/utils/types";

import type { PromptConfigFormValues } from "../types";

const DEFAULT_FORM_VALUES: PromptConfigFormValues = {
  handle: null,
  scope: PromptScope.PROJECT,
  version: {
    configData: {
      prompt: "You are a helpful assistant.",
      llm: {
        model: DEFAULT_MODEL,
        temperature: 0.5,
        maxTokens: 1000,
      },
      messages: [{ role: "user" as const, content: "{{input}}" }],
      inputs: [{ identifier: "input", type: "str" as const }],
      outputs: [{ identifier: "output", type: "str" as const }],
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
  overrides?: DeepPartial<PromptConfigFormValues>
): PromptConfigFormValues => {
  return merge(DEFAULT_FORM_VALUES, overrides ?? {});
};
