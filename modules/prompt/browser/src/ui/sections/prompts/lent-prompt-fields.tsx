/** Prompt's LLM config and outputs editors, lent to the studio and evaluator (§3.4, rule 7). */

import { allModelOptions } from "@langwatch/model-provider-contract";
import type {
  LlmConfigFieldProps,
  LlmConfigPopoverProps,
  OutputsSectionProps,
} from "@langwatch/prompt-client";

import { useModelSelectionOptions } from "../../../behavior/use-model-selection-options.ts";
import { OutputsSection } from "../outputs/outputs-section.tsx";
import { LLMConfigField } from "../prompt-studio/model-selection/llm-config-field.tsx";
import { LLMConfigPopover } from "../prompt-studio/model-selection/llm-config-popover.tsx";

/** The config row, with the chosen model resolved against this project's providers. */
export function LentLlmConfigField(props: LlmConfigFieldProps) {
  const { modelOption, isEmpty } = useModelSelectionOptions({
    options: allModelOptions,
    model: props.llmConfig?.model ?? "",
    mode: "chat",
  });
  return <LLMConfigField {...props} modelOption={modelOption} noModelsConfigured={isEmpty} />;
}

export function LentLlmConfigPopover(props: LlmConfigPopoverProps) {
  return <LLMConfigPopover {...props} />;
}

export function LentOutputsSection(props: OutputsSectionProps) {
  return <OutputsSection {...props} />;
}
