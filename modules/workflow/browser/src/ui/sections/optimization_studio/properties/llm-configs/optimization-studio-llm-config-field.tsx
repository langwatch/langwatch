import type { UiNodeOutput } from "@langwatch/browser-host/declarations";
import type { LLMConfig } from "@langwatch/workflow-contract";
import { normalizeWorkflowLlmConfig } from "@langwatch/workflow-contract";
import { useCallback } from "react";

import { LLMConfigField } from "../../../../../behavior/lent-prompt.tsx";
import { useStudioModelProviders } from "../../../../../behavior/studio-host/use-studio-model-providers.ts";
import { useWorkflowStore } from "../../../../../behavior/use-workflow-store.ts";

type OptimizationStudioLLMConfigFieldProps = {
  llmConfig: LLMConfig;
  onChange: (llmConfig: LLMConfig) => void;
  showProviderKeyMessage?: boolean;
  /** Outputs configuration (for structured outputs) */
  outputs?: UiNodeOutput[];
  /** Callback when outputs change */
  onOutputsChange?: (outputs: UiNodeOutput[]) => void;
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

  const { hasCodeNodes } = useWorkflowStore((state) => ({
    hasCodeNodes: state.nodes.some((node) => node.type === "code"),
  }));

  const modelProviders = useStudioModelProviders();
  const providerIsConfigured = Object.values(modelProviders ?? {}).some(
    (modelProvider) =>
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
      requiresCustomKey={requiresCustomKey}
      showProviderKeyMessage={showProviderKeyMessage}
      outputs={outputs}
      onOutputsChange={onOutputsChange}
      showStructuredOutputs={showStructuredOutputs}
    />
  );
}
