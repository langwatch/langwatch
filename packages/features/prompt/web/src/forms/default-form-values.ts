import { merge } from "lodash-es";

import { getLatestOpenAIChatFlagship } from "@langwatch/model-provider-contract";

import { FALLBACK_MAX_TOKENS } from "../surfaces/llm-parameters/token-limits";
import type { PromptConfigFormValues } from "./prompt-form.schemas";

type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;

// Auto-derived from the model registry — always the newest plain
// `openai/gpt-<major>.<minor>` flagship. Hard fallback only for the
// unreachable case where the registry has no plain flagship.
const DEFAULT_MODEL = getLatestOpenAIChatFlagship() ?? "openai/gpt-5";

/**
 * Single source of truth for default prompt configuration.
 * Used by Playground, Evaluations V3, and Optimization Studio.
 */
export const DEFAULT_FORM_VALUES: PromptConfigFormValues = {
  handle: null,
  scope: "PROJECT",
  version: {
    parameters: {},
    configData: {
      llm: {
        model: DEFAULT_MODEL,
        // Temperature is omitted - not all models support it (e.g., reasoning models)
        // The UI will apply model-appropriate defaults based on supportedParameters
        temperature: undefined,
        // Use high fallback - UI will cap to model's actual max when displayed
        // This ensures new prompts start at model's max (capped by useSliderControl)
        maxTokens: FALLBACK_MAX_TOKENS,
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
