/** Prompt's LLM config and outputs editors, lent to the studio and evaluator (§3.4, rule 7). */

import type {
  UiLlmConfigFieldProps,
  UiLlmConfigPopoverProps,
  UiOutputsSectionProps,
} from "@langwatch/browser-host/declarations";
import { allModelOptions } from "@langwatch/model-provider-browser-kit";

import { useModelSelectionOptions } from "../../../behavior/use-model-selection-options.ts";
import { LLMConfigField } from "../../elements/llmPromptConfigs/llm-config-field.tsx";
import { LLMConfigPopover } from "../../elements/llmPromptConfigs/llm-config-popover.tsx";
import { OutputsSection } from "../../elements/outputs/outputs-section.tsx";

/** The config row, with the chosen model resolved against this project's providers. */
export function LentLlmConfigField(props: UiLlmConfigFieldProps) {
  const { modelOption, isEmpty } = useModelSelectionOptions({
    options: allModelOptions,
    model: props.llmConfig?.model ?? "",
    mode: "chat",
  });
  return <LLMConfigField {...props} modelOption={modelOption} noModelsConfigured={isEmpty} />;
}

export function LentLlmConfigPopover(props: UiLlmConfigPopoverProps) {
  return <LLMConfigPopover {...props} />;
}

export function LentOutputsSection(props: UiOutputsSectionProps) {
  return <OutputsSection {...props} />;
}
