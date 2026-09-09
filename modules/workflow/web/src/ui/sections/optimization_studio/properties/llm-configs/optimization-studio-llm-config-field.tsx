import { useCallback } from "react";
import type { Output } from "@langwatch/prompt-web/surfaces/llm-config-popover";
import { LLMConfigField } from "@langwatch/prompt-web/surfaces/llm-config-field";
import {
  allModelOptions,
  useModelSelectionOptions,
} from "@langwatch/model-provider-web/surfaces/model-selector";
import { useOrganizationTeamProject } from "../../../../../behavior/studio-host/use-organization-team-project.ts";
import { useWorkflowStore } from "../../../../../behavior/use-workflow-store.ts";
import type { LLMConfig } from "@langwatch/workflow-contract";
import { normalizeWorkflowLlmConfig } from "@langwatch/workflow-contract";

type OptimizationStudioLLMConfigFieldProps = {
  llmConfig: LLMConfig;
  onChange: (llmConfig: LLMConfig) => void;
  showProviderKeyMessage?: boolean;
  /** Outputs configuration (for structured outputs) */
  outputs?: Output[];
  /** Callback when outputs change */
  onOutputsChange?: (outputs: Output[]) => void;
  /** Whether to show the structured outputs section */
  showStructuredOutputs?: boolean;
};

/**
 * LLM Config field for the Optimization Studio, specific to its store.
 * Normalizes all LLM configs to snake_case (max_tokens) per the DSL schema.
 */
export function OptimizationStudioLLMConfigField({
  llmConfig,
  onChange,
  showProviderKeyMessage = true,
  outputs,
  onOutputsChange,
  showStructuredOutputs = false,
}: OptimizationStudioLLMConfigFieldProps) {
  const model = llmConfig?.model ?? "";
  const { modelOption, isEmpty } = useModelSelectionOptions(allModelOptions, model, "chat");

  const { hasCodeNodes } = useWorkflowStore((state) => ({
    hasCodeNodes: state.nodes.some((node) => node.type === "code"),
  }));

  const { modelProviders } = useOrganizationTeamProject();
  const providerIsConfigured = Object.values(modelProviders ?? {}).some(
    (modelProvider: any) =>
      model.split("/")[0] === modelProvider.provider &&
      (modelProvider.enabled || modelProvider.customKeys),
  );
  const requiresCustomKey = hasCodeNodes && !providerIsConfigured;

  const handleChange = useCallback(
    (newLlmConfig: LLMConfig) => {
      onChange(normalizeWorkflowLlmConfig(newLlmConfig));
    },
    [onChange],
  );

  return (
    <LLMConfigField
      llmConfig={llmConfig}
      onChange={handleChange}
      modelOption={modelOption}
      requiresCustomKey={requiresCustomKey}
      showProviderKeyMessage={showProviderKeyMessage}
      outputs={outputs}
      onOutputsChange={onOutputsChange}
      showStructuredOutputs={showStructuredOutputs}
      noModelsConfigured={isEmpty}
    />
  );
}
