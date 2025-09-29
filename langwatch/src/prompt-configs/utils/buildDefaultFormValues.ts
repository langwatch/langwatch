import { merge } from "lodash-es";
import type { PromptConfigFormValues } from "../types";
import { PromptScope } from "@prisma/client";
import type { DeepPartial } from "~/utils/types";

const DEFAULT_FORM_VALUES: PromptConfigFormValues = {
  handle: null,
  scope: PromptScope.PROJECT,
  version: {
    configData: {
      prompt: "You are a helpful assistant.",
      llm: {
        model: "openai/gpt-5",
        temperature: 0.5,
        max_tokens: 1000,
      },
      messages: [{ role: "user" as const, content: "{{input}}" }],
      inputs: [{ identifier: "input", type: "str" as const }],
      outputs: [{ identifier: "output", type: "str" as const }],
    },
  },
};


/**
 * Builds the default form values with overrides.
 * Useful since the default model comes from the project settings.
 * @param overrides - Overrides to the default form values
 * @returns The default form values with overrides
 */
export const buildDefaultFormValues = (overrides?: DeepPartial<PromptConfigFormValues>): PromptConfigFormValues => {
  return merge(DEFAULT_FORM_VALUES, overrides ?? {});
};